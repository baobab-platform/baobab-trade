/**
 * ADR-SHARED-039 Trade-A TA-08: the runtime check that a protected Trade
 * runtime is committing through the TA-07 PostgreSQL fences.
 *
 * Certifying a class (PERSISTENCE_FENCED_CLASSES) relies on the database, not
 * on this process, to refuse unauthorised commitments. Before a certified
 * class is honoured in a protected runtime, the database it writes to must
 * show all of the following, read in one statement:
 *
 *   - the recorded persistence posture is ENFORCED (a SANDBOX database leaves
 *     unattributed records to native Medusa);
 *   - every TA-05/TA-07 fence trigger is installed on its own table and
 *     enabled for ordinary sessions (a disabled or replica-only trigger never
 *     fires for Medusa's writes);
 *   - the runtime role is not a superuser, because only a superuser can set
 *     session_replication_role = replica and silently skip every trigger.
 *
 * Any other answer, including a query failure, denies. The check runs per
 * governed operation: it is one catalog read beside the CP round trip, and
 * caching it would let a disabled fence go unnoticed for the cache lifetime.
 *
 * Residual risk (stated in the TA-08 record): the role that owns the native
 * tables can still ALTER them. Separating the migration owner from the
 * runtime role is a protected-staging deployment control, outside this check.
 */
import type { PgPool } from "./postgres-governed-binding-persistence"

/** The fences TA-08 certifies, each on the table it must guard. */
export const TRADE_A_FENCE_TRIGGERS: ReadonlyArray<readonly [table: string, trigger: string]> = [
  ['public."order"', "trade_a_order_commit_fence"],
  ["public.cart", "trade_a_cart_commit_fence"],
  ["public.trade_order_commitment", "trade_order_commitment_guard"],
  ["public.trade_order_commitment", "trade_order_commitment_no_truncate"],
  ["public.trade_order_commitment", "trade_order_commitment_content"],
  ["public.trade_order_authority_receipt", "trade_order_authority_receipt_guard"],
  ["public.trade_order_authority_receipt", "trade_order_authority_receipt_no_truncate"],
  ["public.trade_a_persistence_posture", "trade_a_persistence_posture_guard"],
  ["public.trade_a_persistence_posture", "trade_a_persistence_posture_no_truncate"],
]

export type PersistencePostureVerdict =
  | { enforced: true }
  | {
      enforced: false
      reason: "POSTURE_NOT_ENFORCED" | "FENCE_NOT_ACTIVE" | "SUPERUSER_RUNTIME_ROLE"
    }

export interface PersistencePostureReader {
  verify(): Promise<PersistencePostureVerdict>
}

type PostureRow = { posture: string | null; superuser: boolean | null; active_fences: string }

// tgenabled: 'O' fires in ordinary (origin) sessions, 'A' always; 'R' (replica
// only) and 'D' (disabled) never fire for Medusa's writes.
const VERIFY_SQL = `
  SELECT (SELECT posture FROM trade_a_persistence_posture) AS posture,
         (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
         (SELECT count(*) FROM unnest($1::text[], $2::text[]) AS f(rel, name)
            JOIN pg_trigger t ON t.tgrelid = to_regclass(f.rel) AND t.tgname = f.name
           WHERE t.tgenabled IN ('O', 'A')) AS active_fences`

export class PostgresPersistencePostureReader implements PersistencePostureReader {
  constructor(private readonly pool: PgPool) {}

  async verify(): Promise<PersistencePostureVerdict> {
    const client = await this.pool.connect()
    try {
      const { rows } = await client.query(VERIFY_SQL, [
        TRADE_A_FENCE_TRIGGERS.map(([table]) => table),
        TRADE_A_FENCE_TRIGGERS.map(([, trigger]) => trigger),
      ])
      return judgePosture(rows[0] as PostureRow | undefined)
    } finally {
      client.release()
    }
  }
}

/** Exported for unit tests: the verdict from one VERIFY_SQL row. */
export function judgePosture(row: PostureRow | undefined): PersistencePostureVerdict {
  // A missing posture row reads as ENFORCED in the fences (fail closed there);
  // here it also proves TA-07 was never applied, so it is not certifiable.
  if (row?.posture !== "ENFORCED") return { enforced: false, reason: "POSTURE_NOT_ENFORCED" }
  if (row.superuser !== false) return { enforced: false, reason: "SUPERUSER_RUNTIME_ROLE" }
  if (Number(row.active_fences) !== TRADE_A_FENCE_TRIGGERS.length)
    return { enforced: false, reason: "FENCE_NOT_ACTIVE" }
  return { enforced: true }
}
