import type { IOrderModuleService, OrderTypes } from "@medusajs/framework/types"
import type { PgClient } from "../orders/postgres-governed-binding-persistence"
import { refusalFor, type PostgresSpendReservationCommands } from "./spend-reservation-commands"
import {
  commitAuthorizedNativeBuyerOrder,
  type AuthorizedCommitment,
  type NativeCommitOutcome,
  type NativeCommitRequest,
  type NativeErpOrderConsequence,
} from "./native-buyer-commitment"
import type { FinalNativeValuationFacts } from "./buyer-commitment-valuation"
import {
  requireCurrentNativeCommitAuthority,
  type NativeCommitAuthorityReadback,
} from "./native-commit-authority-readback"

/**
 * DEV-07 CAA-06b: pinned Medusa 2.21.2 Order Module native transaction owner.
 *
 * The Order Module's protected baseRepository_ is the sole compatibility
 * boundary. Medusa exposes baseRepository.transaction publicly *inside* a
 * module service, but does not expose an app-level Order transaction factory.
 * Fail closed on any incompatible runtime; never replace it with an external
 * node-postgres transaction or independent createOrderWorkflow invocation.
 *
 * This bridge is server-only and not a checkout route. In particular, a
 * caller cannot supply a forged authority snapshot from a browser.
 */
type NativeSqlResult = {
  rows: Array<Record<string, unknown>>
  rowCount: number | null
}
type NativeTransaction = {
  raw(sql: string, bindings?: unknown[]): Promise<NativeSqlResult>
}
type NativeManager = {
  getTransactionContext(): NativeTransaction | undefined
}
type OrderModuleTransactionRepository = {
  transaction<T>(callback: (manager: NativeManager) => Promise<T>): Promise<T>
}

/**
 * PostgreSQL row xmin is 32-bit while pg_current_xact_id is the full 64-bit
 * XID. Compare only the current XID's stored lower 32 bits, so the proof does
 * not fail after a wraparound. Never coerce an absent or nonnumeric XID.
 */
export function nativeXid32(xid: string): string {
  if (!/^[0-9]+$/.test(xid)) throw new Error("MEDUSA_NATIVE_TRANSACTION_XID_UNAVAILABLE")
  return (BigInt(xid) % 4294967296n).toString()
}

function nativeRepository(service: IOrderModuleService): OrderModuleTransactionRepository {
  // Pinned Medusa compatibility seam. Keep undocumented property access here
  // rather than allowing arbitrary callers to pretend to own a transaction.
  const repo = (service as unknown as { baseRepository_?: OrderModuleTransactionRepository })
    .baseRepository_
  if (!repo || typeof repo.transaction !== "function") {
    throw new Error("MEDUSA_ORDER_TRANSACTION_OWNER_UNAVAILABLE")
  }
  return repo
}

/**
 * Turn numbered pg parameters into Knex bindings, preserving repeated and
 * reordered arguments. This boundary only accepts the reviewed Trade SQL
 * used by the spend and event commands; no SQL with unbound native '?' input.
 */
export function medusaNativeQuery(transaction: NativeTransaction): PgClient {
  return {
    query: async (sql: string, values: readonly unknown[] = []) => {
      if (sql.includes("?")) throw new Error("MEDUSA_SQL_BINDING_UNSAFE")
      const bindings: unknown[] = []
      const rendered = sql.replace(/\$(\d+)\b/g, (_whole, ordinal: string) => {
        const index = Number(ordinal) - 1
        if (!Number.isSafeInteger(index) || index < 0 || index >= values.length) {
          throw new Error("MEDUSA_SQL_BINDING_INVALID")
        }
        bindings.push(values[index])
        return "?"
      })
      if (values.length > 0 && bindings.length === 0) {
        throw new Error("MEDUSA_SQL_BINDING_MISSING")
      }
      const result = await transaction.raw(rendered, bindings)
      if (!result || !Array.isArray(result.rows)) {
        throw new Error("MEDUSA_SQL_RESULT_INVALID")
      }
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length }
    },
    release: () => {
      throw new Error("MEDUSA_NATIVE_TRANSACTION_OWNED_BY_ORDER_MODULE")
    },
  }
}

/**
 * Expose the pinned native Order Module transaction for the disposable
 * PostgreSQL 17 smoke, without opening a second node-postgres transaction.
 * Production composition uses the same manager and SQL bridge below.
 */
export async function withNativeMedusaOrderTransaction<T>(
  service: IOrderModuleService,
  callback: (scope: { manager: NativeManager; db: PgClient; xid: string }) => Promise<T>,
): Promise<T> {
  return nativeRepository(service).transaction(async (manager) => {
    const transaction = manager?.getTransactionContext?.()
    if (!transaction || typeof transaction.raw !== "function") {
      throw new Error("MEDUSA_ORDER_TRANSACTION_CONTEXT_UNAVAILABLE")
    }
    const db = medusaNativeQuery(transaction)
    const xid = await currentXid(db)
    const result = await callback({ manager, db, xid })
    if ((await currentXid(db)) !== xid) throw new Error("MEDUSA_ORDER_TRANSACTION_CHANGED")
    return result
  })
}

/** Medusa's public CreateOrderDTO omits the internal persistence id/draft
 * fields. This deliberately narrow 2.21 native-owner extension requires
 * both explicit non-draft persistence and the exact preallocated order ID. */
type NativeOrderInput = OrderTypes.CreateOrderDTO & {
  id: string
  is_draft_order: false
  status: "pending"
}
type NativeFacts = {
  valuation: FinalNativeValuationFacts
  erp: NativeErpOrderConsequence
  /** Persisted order currency metadata, not a caller-asserted default. */
  currencyExponent: number
}

/** Server-only provider; implementation must derive facts from the order and
 * cart records in the *same* managed native transaction. */
export type NativeMedusaOrderSource = {
  orderInput(
    db: Pick<PgClient, "query">,
    nativeOrderId: string,
    authority: AuthorizedCommitment,
  ): Promise<NativeOrderInput>
  readFinal(
    db: Pick<PgClient, "query">,
    nativeOrderId: string,
    authority: AuthorizedCommitment,
  ): Promise<NativeFacts>
}

export type MedusaNativeOwnerDependencies = {
  /** Real Medusa 2.21.2 Order Module service, never a stub in production. */
  orderModule: IOrderModuleService
  spend: PostgresSpendReservationCommands
  /** Fresh IAM+CP Principal, buyer operation and seller PEP readbacks. */
  authorizeNow(): Promise<AuthorizedCommitment>
  /**
   * Must issue a new actual IAM/CP/Trade readback UNDER the spend row lock,
   * before native order creation. No stale cached buyer-context ALLOW.
   */
  recheckAuthorityNow(original: AuthorizedCommitment): Promise<NativeCommitAuthorityReadback>
  /** Independent native database reader, never caller-submitted money. */
  source: NativeMedusaOrderSource
  now?: () => number
  newEventId?: () => string
}

type TransactionScope = {
  manager: NativeManager
  db: PgClient
  xid: string
}

async function currentXid(db: Pick<PgClient, "query">): Promise<string> {
  const row = (await db.query("SELECT pg_current_xact_id()::text AS xid")).rows[0]
  if (typeof row?.xid !== "string" || !/^\d+$/.test(row.xid)) {
    throw new Error("MEDUSA_NATIVE_TRANSACTION_XID_UNAVAILABLE")
  }
  return row.xid
}

/**
 * Actually creates the order through the core Order Module, with the SAME
 * native MikroORM/Knex transactionManager that executes the spend and outbox
 * SQL. PostgreSQL's order.xmin is then compared with that transaction's xid.
 *
 * Throws from the owner callback on all failures. The repository must roll
 * back the native order, budget ledger, receipt consumption and event together.
 * A successful idempotent replay never executes createOrders again.
 */
export async function commitMedusaNativeBuyerOrder(
  deps: MedusaNativeOwnerDependencies,
  request: NativeCommitRequest,
): Promise<NativeCommitOutcome> {
  // No permissive fallback when Medusa's pinned transaction entry is absent.
  let repo: OrderModuleTransactionRepository
  try {
    repo = nativeRepository(deps.orderModule)
  } catch {
    return { outcome: "REFUSED", reason: "NATIVE_ORDER_OWNER_UNAVAILABLE" }
  }

  let currentAuthority: AuthorizedCommitment | null = null
  const live = new WeakMap<object, TransactionScope>()
  const finalSnapshots = new WeakMap<object, NativeFacts>()
  const currentSnapshot = async (
    db: Pick<PgClient, "query">,
    nativeOrderId: string,
  ): Promise<NativeFacts> => {
    read(db)
    const current = finalSnapshots.get(db)
    if (current) return current
    if (!currentAuthority) throw new Error("MEDUSA_CURRENT_AUTHORITY_MISSING")
    // Read the final native-order lines and all obligation components ONCE
    // inside the owning XID. A separately evaluated tax/freight read for the
    // ERP payload must not silently differ from the buyer's price readback.
    const snapshot = await deps.source.readFinal(db, nativeOrderId, currentAuthority)
    if (!snapshot?.valuation || !snapshot.erp || !Number.isSafeInteger(snapshot.currencyExponent)) {
      throw new Error("MEDUSA_FINAL_NATIVE_ORDER_SNAPSHOT_UNAVAILABLE")
    }
    finalSnapshots.set(db, snapshot)
    return snapshot
  }
  const read = (db: Pick<PgClient, "query">): TransactionScope => {
    const scope = live.get(db)
    if (!scope) throw new Error("MEDUSA_NATIVE_TRANSACTION_SCOPE_INVALID")
    return scope
  }

  return commitAuthorizedNativeBuyerOrder(
    {
      authorizeNow: async () => {
        // One request owns one closure; authorisation is re-issued per attempt.
        currentAuthority = await deps.authorizeNow()
        // The TA-07 native INSERT fence currently supports a cart commitment.
        // Direct-order and draft-finalisation are different persistence paths;
        // accepting them through this owner would bypass the matching receipt.
        if (currentAuthority?.receipt?.operation !== "trade.order.commit") {
          throw new Error("MEDUSA_ORDER_OPERATION_NOT_SUPPORTED_BY_NATIVE_FENCE")
        }
        return currentAuthority
      },
      now: deps.now,
      newEventId: deps.newEventId,
      spend: {
        commitWithMutation: async (command, mutation) => {
          try {
            return await repo.transaction(async (manager) => {
              const trx = manager?.getTransactionContext?.()
              if (!trx || typeof trx.raw !== "function") {
                throw new Error("MEDUSA_ORDER_TRANSACTION_CONTEXT_UNAVAILABLE")
              }
              const db = medusaNativeQuery(trx)
              const xid = await currentXid(db)
              let checkedAuthority: NativeCommitAuthorityReadback | undefined
              const outcome = await deps.spend.commitWithOwnerTransaction(
                command,
                db,
                async (bounded) => {
                  if (!currentAuthority || typeof deps.recheckAuthorityNow !== "function") {
                    throw new Error("CURRENT_NATIVE_COMMIT_AUTHORITY_NOT_PROVEN")
                  }
                  const current = await deps.recheckAuthorityNow(currentAuthority)
                  requireCurrentNativeCommitAuthority(
                    currentAuthority,
                    current,
                    (deps.now ?? Date.now)(),
                  )
                  checkedAuthority = current
                  const scope = { manager, db, xid }
                  live.set(bounded, scope)
                  try {
                    await mutation(bounded)
                  } finally {
                    finalSnapshots.delete(bounded)
                    live.delete(bounded)
                  }
                },
              )
              if ((await currentXid(db)) !== xid) {
                throw new Error("MEDUSA_ORDER_TRANSACTION_CHANGED")
              }
              // The fresh readback can have a shorter lease than the original
              // buyer/seller receipt. Include source reads and final ledger /
              // idempotency work in that deadline before the owner may commit.
              // Replays do not mutate and never enter the authority callback.
              if (checkedAuthority && currentAuthority) {
                requireCurrentNativeCommitAuthority(
                  currentAuthority,
                  checkedAuthority,
                  (deps.now ?? Date.now)(),
                )
              }
              // Never convert a native owner exception into a normal return
              // inside the transaction; only the outer catch may return REFUSED.
              if (outcome.outcome === "REFUSED" || outcome.outcome === "CONFLICT") {
                throw new Error("MEDUSA_ORDER_TRANSACTION_REFUSED")
              }
              return outcome
            })
          } catch (error) {
            // Repository rollback has completed before returning a refusal.
            return { outcome: "REFUSED", reason: refusalFor(error) }
          }
        },
      },
      native: {
        writeOrder: async (db, orderId) => {
          const scope = read(db)
          const authority = currentAuthority
          if (!authority) throw new Error("MEDUSA_CURRENT_AUTHORITY_MISSING")
          const input = await deps.source.orderInput(db, orderId, authority)
          if (input?.id !== orderId) throw new Error("MEDUSA_NATIVE_ORDER_ID_MISMATCH")
          if (input.is_draft_order !== false || input.status !== "pending") {
            throw new Error("MEDUSA_NATIVE_COMMIT_REQUIRES_NON_DRAFT_PENDING_ORDER")
          }
          const order = await deps.orderModule.createOrders(input, {
            transactionManager: scope.manager,
          } as never)
          if (order?.id !== orderId) throw new Error("MEDUSA_NATIVE_ORDER_ID_MISMATCH")
          const result = await db.query(
            'SELECT xmin::text AS xid FROM "order" WHERE id=$1 AND deleted_at IS NULL',
            [orderId],
          )
          // A separately committed Medusa workflow is NEVER transaction owner.
          if (result.rowCount !== 1 || result.rows[0].xid !== nativeXid32(scope.xid)) {
            throw new Error("MEDUSA_ORDER_OUTSIDE_OWNER_TRANSACTION")
          }
        },
        readFinalValuation: async (db, id) => {
          read(db)
          if (!currentAuthority) throw new Error("MEDUSA_CURRENT_AUTHORITY_MISSING")
          return (await currentSnapshot(db, id)).valuation
        },
        readErpConsequence: async (db, id) => {
          read(db)
          if (!currentAuthority) throw new Error("MEDUSA_CURRENT_AUTHORITY_MISSING")
          return (await currentSnapshot(db, id)).erp
        },
        readCurrencyExponent: async (db, id) => {
          read(db)
          if (!currentAuthority) throw new Error("MEDUSA_CURRENT_AUTHORITY_MISSING")
          return (await currentSnapshot(db, id)).currencyExponent
        },
      },
    },
    request,
  )
}
