import { describe, expect, it, vi } from "vitest"
import {
  commitAuthorizedNativeBuyerOrder,
  type AuthorizedCommitment,
  type NativeCommitDependencies,
} from "../src/baobab/b2b/native-buyer-commitment"
import type { PgClient } from "../src/baobab/orders/postgres-governed-binding-persistence"

import {
  NOW,
  eventId,
  valuationFacts,
  request,
  syntheticCommitmentProof as proof,
  syntheticErpConsequence,
} from "./fixtures/native-buyer-commitment"

function harness(changed?: (p: AuthorizedCommitment) => void) {
  const queries: string[] = []
  const p = proof()
  changed?.(p)
  const db: Pick<PgClient, "query"> = {
    query: async (sql) => {
      queries.push(sql)
      return { rows: [], rowCount: 1 }
    },
  }
  const writer = vi.fn(async () => {
    queries.push("NATIVE_MEDUSA_ORDER_WRITE")
  })
  const commitWithMutation = vi.fn(
    async (_command: unknown, mutation: (db: Pick<PgClient, "query">) => Promise<void>) => {
      await mutation(db)
      return {
        outcome: "APPLIED" as const,
        reservationId: p.receipt.spend_reservation_id,
        status: "COMMITTED" as const,
        holdRevision: 1,
      }
    },
  )
  const deps: NativeCommitDependencies = {
    authorizeNow: async () => p,
    spend: { commitWithMutation },
    now: () => NOW.getTime(),
    newEventId: () => eventId,
    native: {
      writeOrder: writer,
      readFinalValuation: async () => valuationFacts,
      readCurrencyExponent: async () => 0, // UGX synthetic fixture; real owner must reread native currency.
      readErpConsequence: async () => syntheticErpConsequence(),
    },
  }
  return { deps, queries, writer, commitWithMutation }
}

describe("CAA-06b proposed owner transaction composition (source-only, not activated)", () => {
  it("creates the one canonical outbox and buyer consumption through the spend transaction", async () => {
    const h = harness()
    expect(await commitAuthorizedNativeBuyerOrder(h.deps, request)).toEqual({
      outcome: "COMMITTED",
      orderId: request.nativeOrderId,
      eventId,
    })
    expect(h.commitWithMutation).toHaveBeenCalledOnce()
    expect(h.writer).toHaveBeenCalledOnce()
    expect(h.queries[0]).toContain("INSERT INTO trade_buyer_authority_receipt")
    expect(h.queries[1]).toBe("NATIVE_MEDUSA_ORDER_WRITE")
    expect(h.queries[2]).toContain("INSERT INTO event_outbox")
    expect(h.queries[3]).toContain("INSERT INTO trade_buyer_authority_consumption")
    // A unit stub is not proof of real native order insertion or a PG XID.
  })

  it("does not accept discovery ALLOW as order permission without a fresh separate decision", async () => {
    const h = harness((p) => {
      p.operationDecision.outcome = "ALLOW"
      p.operationDecision.operation = "trade.order.create"
    })
    expect((await commitAuthorizedNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
    expect(h.commitWithMutation).not.toHaveBeenCalled()
  })

  it.each([
    "resource_id",
    "resource_version",
    "transaction_digest",
    "amount_minor",
    "currency",
    "valuation_digest",
    "seller_legal_entity_id",
    "seller_binding_reference",
  ] as const)("refuses an incomplete consequential context (%s) before spend", async (field) => {
    const h = harness((p) => {
      Reflect.deleteProperty(p.context, field)
    })
    expect(await commitAuthorizedNativeBuyerOrder(h.deps, request)).toEqual({
      outcome: "REFUSED",
      reason: "CURRENT_IAM_CP_BUYER_AUTHORITY_NOT_PROVEN",
    })
    expect(h.commitWithMutation).not.toHaveBeenCalled()
  })

  it("refuses a schema-valid context naming a different purchase amount", async () => {
    const h = harness((p) => {
      p.context.amount_minor = (p.context.amount_minor ?? 0) + 1
    })
    expect((await commitAuthorizedNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
    expect(h.commitWithMutation).not.toHaveBeenCalled()
  })

  it("denies stale, mismatched and foreign buyer/seller proofs before touching spend", async () => {
    for (const mutate of [
      (p: AuthorizedCommitment) => {
        p.receipt.amount_minor++
      },
      (p: AuthorizedCommitment) => {
        p.receipt.spend_hold_revision = 2
        p.receipt.spend_reservation_id = "b2bres_other"
      },
      (p: AuthorizedCommitment) => {
        p.receipt.seller_binding_reference.binding_version++
      },
      (p: AuthorizedCommitment) => {
        p.context.operation = "trade.buyer-context.resolve"
      },
      (p: AuthorizedCommitment) => {
        p.receipt.expires_at = "2026-11-04T16:00:14Z"
      },
      (p: AuthorizedCommitment) => {
        p.seller.operation_reference = "foreign/operation"
      },
    ]) {
      const h = harness(mutate)
      expect((await commitAuthorizedNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
      expect(h.commitWithMutation).not.toHaveBeenCalled()
    }
  })

  it("refuses ERP totals that differ from the exact native buyer obligation", async () => {
    for (const wrong of [
      { amount: "1250001", currency: "UGX", exponent: 0 },
      { amount: "1250000.1", currency: "UGX", exponent: 0 },
      { amount: "1250000", currency: "ZAR", exponent: 0 },
      { amount: "1250000", currency: "UGX", exponent: Number.NaN },
    ]) {
      const h = harness()
      const original = h.deps.native.readErpConsequence
      h.deps.native.readCurrencyExponent = async () => wrong.exponent
      h.deps.native.readErpConsequence = async (db, id) => {
        const data = await original(db, id)
        return {
          ...data,
          totals: {
            ...data.totals,
            grand_total: { amount: wrong.amount, currency: wrong.currency },
          },
        }
      }
      h.deps.spend.commitWithMutation = async (_command, mutation) => {
        await expect(
          mutation({
            query: async (sql) => {
              h.queries.push(sql)
              return { rows: [], rowCount: 1 }
            },
          }),
        ).rejects.toThrow("NATIVE_ERP_BUSINESS_FACTS_NOT_VERIFIED")
        return { outcome: "REFUSED", reason: "TRANSACTION_CHANGED" }
      }
      expect((await commitAuthorizedNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
      expect(h.queries.some((sql) => sql.includes("INSERT INTO event_outbox"))).toBe(false)
      expect(
        h.queries.some((sql) => sql.includes("INSERT INTO trade_buyer_authority_consumption")),
      ).toBe(false)
    }
  })

  it("rejects noncanonical ERP consequence facts inside the spend transaction", async () => {
    const h = harness()
    const original = h.deps.native.readErpConsequence
    h.deps.native.readErpConsequence = async (db, orderId) => ({
      ...(await original(db, orderId)),
      unreviewed_native_field: "not in the pinned ERP contract",
    })
    h.deps.spend.commitWithMutation = async (_command, mutation) => {
      await expect(
        mutation({
          query: async (sql) => {
            h.queries.push(sql)
            return { rows: [], rowCount: 1 }
          },
        }),
      ).rejects.toThrow("NATIVE_ERP_BUSINESS_FACTS_NOT_VERIFIED")
      return { outcome: "REFUSED", reason: "TRANSACTION_CHANGED" }
    }
    expect(await commitAuthorizedNativeBuyerOrder(h.deps, request)).toEqual({
      outcome: "REFUSED",
      reason: "TRANSACTION_CHANGED",
    })
    expect(h.queries.some((sql) => sql.includes("INSERT INTO event_outbox"))).toBe(false)
    expect(
      h.queries.some((sql) => sql.includes("INSERT INTO trade_buyer_authority_consumption")),
    ).toBe(false)
  })

  it("refuses if native final pricing diverges before publishing or consumption", async () => {
    const h = harness()
    h.deps.native.readFinalValuation = async () => ({
      ...valuationFacts,
      components: [{ ...valuationFacts.components[0], amount_minor: 1350000 }],
    })
    // The real spend command rolls back on a callback error. This stub
    // mimics the *refusal*, not PostgreSQL transactional guarantees.
    h.deps.spend.commitWithMutation = async (command, mutation) => {
      expect(command.amountMinor).toBe(1250000n)
      await expect(
        mutation({
          query: async (sql) => {
            h.queries.push(sql)
            return { rows: [], rowCount: 1 }
          },
        }),
      ).rejects.toThrow("NATIVE_FINAL_VALUATION_CHANGED")
      return { outcome: "REFUSED", reason: "TRANSACTION_CHANGED" }
    }
    expect(await commitAuthorizedNativeBuyerOrder(h.deps, request)).toEqual({
      outcome: "REFUSED",
      reason: "TRANSACTION_CHANGED",
    })
    expect(h.queries.some((q) => q.includes("INSERT INTO event_outbox"))).toBe(false)
  })
})
