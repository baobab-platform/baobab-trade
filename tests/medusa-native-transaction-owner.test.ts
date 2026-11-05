import assert from "node:assert/strict"
import { describe, expect, it, vi } from "vitest"
import type { IOrderModuleService } from "@medusajs/framework/types"
import {
  commitMedusaNativeBuyerOrder,
  medusaNativeQuery,
  nativeXid32,
} from "../src/baobab/b2b/medusa-native-transaction-owner"
import type { NativeCommitAuthorityReadback } from "../src/baobab/b2b/native-commit-authority-readback"
import { PostgresSpendReservationCommands } from "../src/baobab/b2b/spend-reservation-commands"
import {
  NOW,
  eventId,
  request,
  valuationFacts,
  syntheticCommitmentProof,
  syntheticErpConsequence,
} from "./fixtures/native-buyer-commitment"

/**
 * Owner-boundary unit harness: real composition/authority predicates, mocked
 * native and ledger ports. It proves exception propagation and deadline
 * ordering only, never PostgreSQL rollback or current IAM/CP connectivity.
 */
function ownerHarness() {
  const original = syntheticCommitmentProof()
  let clock = NOW.getTime()
  const queries: string[] = []
  const readback: NativeCommitAuthorityReadback = {
    outcome: "ALLOW",
    actorStatus: "ACTIVE",
    membershipStatus: "ACTIVE",
    sellerMandateStatus: "ACTIVE",
    tenantId: original.receipt.tenant_id,
    principalId: original.receipt.actor_principal_id,
    canonicalOrganisationId: original.receipt.canonical_organisation_id,
    buyerOrganisationId: original.receipt.buyer_organisation_id,
    membershipId: original.receipt.buyer_membership_id,
    membershipRevision: original.receipt.membership_revision,
    marketId: original.receipt.market_id,
    operation: original.receipt.operation,
    resourceId: original.receipt.resource_id,
    resourceVersion: original.receipt.resource_version,
    transactionDigest: original.receipt.transaction_digest,
    amountMinor: original.receipt.amount_minor,
    currency: original.receipt.currency,
    spendReservationId: original.receipt.spend_reservation_id,
    spendHoldRevision: original.receipt.spend_hold_revision,
    sellerBindingId: original.seller.binding_id,
    sellerBindingVersion: original.seller.binding_version,
    sellerMandateId: original.seller.mandate_id,
    sellerLegalEntityId: original.seller.responsible_legal_entity_id,
    checkedAt: new Date(clock - 1000).toISOString(),
    expiresAt: new Date(clock + 5000).toISOString(),
    // These strings exercise the predicate, not an independent source.
    evidenceReferences: ["unit-only:issuer-readback", "unit-only:cp-readback"],
  }
  const transaction = {
    raw: vi.fn(async (sql: string) => {
      queries.push(sql)
      if (sql.includes("pg_current_xact_id")) {
        return { rows: [{ xid: "4294967301" }], rowCount: 1 }
      }
      if (sql.includes("SELECT xmin")) return { rows: [{ xid: "5" }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    }),
  }
  const manager = { getTransactionContext: () => transaction }
  const settled: string[] = []
  const createOrders = vi.fn(async () => ({ id: request.nativeOrderId }))
  const orderModule = {
    baseRepository_: {
      transaction: async (callback: (m: typeof manager) => Promise<unknown>) => {
        try {
          const result = await callback(manager)
          settled.push("commit")
          return result
        } catch (error) {
          settled.push("rollback")
          throw error
        }
      },
    },
    createOrders,
  } as unknown as IOrderModuleService
  const spend = new PostgresSpendReservationCommands({
    connect: vi.fn(async () => {
      throw new Error("The native owner must not open a separate ledger connection")
    }),
  })
  const commit = vi.spyOn(spend, "commitWithOwnerTransaction")
  commit.mockImplementation(async (_command, owner, mutation) => {
    await mutation(owner)
    return {
      outcome: "APPLIED",
      reservationId: original.receipt.spend_reservation_id,
      status: "COMMITTED",
      holdRevision: 1,
    }
  })
  const source = {
    readFinalCart: vi.fn(async () => ({
      valuation: structuredClone(valuationFacts),
      sourceFingerprint: valuationFacts.transaction_digest,
      leaseExpiresAt: NOW.getTime() + 20_000,
    })),
    orderInput: vi.fn(async () => ({
      id: request.nativeOrderId,
      is_draft_order: false as const,
      status: "pending" as const,
      currency_code: "ugx",
      items: [{ title: "Synthetic unit fixture", quantity: 1, unit_price: 1250000 }],
    })),
    readFinal: vi.fn(async () => ({
      valuation: structuredClone(valuationFacts),
      erp: syntheticErpConsequence(),
      currencyExponent: 0,
    })),
  }
  return {
    original,
    readback,
    queries,
    settled,
    manager,
    createOrders,
    commit,
    source,
    transaction,
    advanceTo: (time: number) => {
      clock = time
    },
    deps: {
      orderModule,
      spend,
      source,
      authorizeNow: async () => original,
      recheckAuthorityNow: vi.fn(async () => readback),
      now: () => clock,
      newEventId: () => eventId,
    },
  }
}

describe("CAA-06b native Medusa transaction boundary", () => {
  it("compares a 64-bit transaction to 32-bit PostgreSQL row xmin without truncating the source", () => {
    expect(nativeXid32("1")).toBe("1")
    expect(nativeXid32("4294967297")).toBe("1")
    expect(() => nativeXid32("")).toThrow("MEDUSA_NATIVE_TRANSACTION_XID_UNAVAILABLE")
    expect(() => nativeXid32("not-a-number")).toThrow("MEDUSA_NATIVE_TRANSACTION_XID_UNAVAILABLE")
  })

  it("binds repeated and out-of-order pg parameters to the same Knex transaction", async () => {
    const raw = vi.fn(async (statement: string, bindings: unknown[]) => ({
      rows: [{ statement, bindings }],
      rowCount: 1,
    }))
    const db = medusaNativeQuery({ raw })
    expect(
      (await db.query("SELECT $2 AS second, $1 AS first, $2 AS again", ["a", "b"])).rows[0],
    ).toEqual({
      statement: "SELECT ? AS second, ? AS first, ? AS again",
      bindings: ["b", "a", "b"],
    })
    expect(raw).toHaveBeenCalledOnce()
    await expect(db.query("SELECT $2", ["only-one"])).rejects.toThrow("MEDUSA_SQL_BINDING_INVALID")
    await expect(db.query("SELECT ?", ["unsafe"])).rejects.toThrow("MEDUSA_SQL_BINDING_UNSAFE")
    await expect(db.query("SELECT 1", ["unused"])).rejects.toThrow("MEDUSA_SQL_BINDING_MISSING")
    expect(() => db.release()).toThrow("MEDUSA_NATIVE_TRANSACTION_OWNED_BY_ORDER_MODULE")
  })

  it("refuses absent Order Module transaction ownership before asking for authority", async () => {
    const authorise = vi.fn(async () => {
      throw new Error("must not be reached")
    })
    const outcome = await commitMedusaNativeBuyerOrder(
      {
        orderModule: {} as IOrderModuleService,
        spend: {} as never,
        source: {} as never,
        authorizeNow: authorise,
        recheckAuthorityNow: async () => {
          throw new Error("must not reach IAM/CP for an unavailable native owner")
        },
      },
      {
        nativeOrderId: "order_native_synthetic",
        idempotencyKey: "native.test.20261104.01",
        correlationId: "f04d8f4e-3d76-4b09-b3d0-1b645c87546a",
        tenant: {} as never,
      },
    )
    expect(outcome).toEqual({ outcome: "REFUSED", reason: "NATIVE_ORDER_OWNER_UNAVAILABLE" })
    expect(authorise).not.toHaveBeenCalled()
  })

  it("refuses a native order service without a real transaction factory", async () => {
    const nativeOrder = {
      baseRepository_: {
        transaction: "not-a-function",
      },
      createOrders: vi.fn(),
    } as unknown as IOrderModuleService
    expect(
      await commitMedusaNativeBuyerOrder(
        {
          orderModule: nativeOrder,
          spend: {} as never,
          source: {} as never,
          authorizeNow: vi.fn(async () => {
            throw new Error("must not run")
          }),
          recheckAuthorityNow: async () => {
            throw new Error("must not reach IAM/CP for an unavailable native owner")
          },
        },
        {
          nativeOrderId: "order_native_synthetic",
          idempotencyKey: "native.test.20261104.02",
          correlationId: "f04d8f4e-3d76-4b09-b3d0-1b645c87546a",
          tenant: {} as never,
        },
      ),
    ).toEqual({ outcome: "REFUSED", reason: "NATIVE_ORDER_OWNER_UNAVAILABLE" })
  })

  it("composes one final snapshot through the manager while the unit authority lease is current", async () => {
    const h = ownerHarness()
    expect(await commitMedusaNativeBuyerOrder(h.deps, request)).toEqual({
      outcome: "COMMITTED",
      orderId: request.nativeOrderId,
      eventId,
    })
    expect(h.settled).toEqual(["commit"])
    expect(h.source.readFinal).toHaveBeenCalledOnce()
    expect(h.source.readFinalCart).toHaveBeenCalledTimes(2)
    expect(h.createOrders).toHaveBeenCalledWith(
      expect.objectContaining({ is_draft_order: false }),
      { transactionManager: h.manager },
    )
  })

  it("refuses missing final-cart proof before writing an order", async () => {
    const h = ownerHarness()
    h.source.readFinalCart.mockImplementationOnce(async () => {
      throw new Error("NATIVE_FINAL_CART_CHARGE_DETERMINATION_MISSING")
    })
    expect((await commitMedusaNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
    expect(h.settled).toEqual(["rollback"])
    expect(h.createOrders).not.toHaveBeenCalled()
  })

  it("refuses a repriced cart before creation even if the authority lease is live", async () => {
    const h = ownerHarness()
    h.source.readFinalCart.mockResolvedValue({
      valuation: {
        ...structuredClone(valuationFacts),
        components: [{ ...valuationFacts.components[0], amount_minor: 1250001 }],
      },
      sourceFingerprint: valuationFacts.transaction_digest,
      leaseExpiresAt: NOW.getTime() + 20_000,
    })
    expect((await commitMedusaNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
    expect(h.settled).toEqual(["rollback"])
    expect(h.createOrders).not.toHaveBeenCalled()
  })

  it("re-reads every priced fact after event/ledger work, refusing a new duty quote", async () => {
    const h = ownerHarness()
    h.source.readFinalCart
      .mockResolvedValueOnce({
        valuation: structuredClone(valuationFacts),
        sourceFingerprint: valuationFacts.transaction_digest,
        leaseExpiresAt: NOW.getTime() + 20_000,
      })
      .mockResolvedValueOnce({
        valuation: structuredClone(valuationFacts),
        sourceFingerprint: "sha256:" + "f".repeat(64),
        leaseExpiresAt: NOW.getTime() + 20_000,
      })
    expect((await commitMedusaNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
    expect(h.settled).toEqual(["rollback"])
    expect(h.source.readFinalCart).toHaveBeenCalledTimes(2)
    expect(h.createOrders).toHaveBeenCalledOnce()
  })

  it("propagates a revoked readback out of the owner before the native writer", async () => {
    const h = ownerHarness()
    h.readback.actorStatus = "INACTIVE"
    expect((await commitMedusaNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
    expect(h.settled).toEqual(["rollback"])
    expect(h.createOrders).not.toHaveBeenCalled()
  })

  it("rolls back when the first price issuer lease expires during ledger settlement", async () => {
    const h = ownerHarness()
    const expiry = NOW.getTime() + 1000
    h.source.readFinalCart.mockResolvedValueOnce({
      valuation: structuredClone(valuationFacts),
      sourceFingerprint: valuationFacts.transaction_digest,
      leaseExpiresAt: expiry,
    })
    const commit = h.commit.getMockImplementation()
    assert.ok(commit)
    h.commit.mockImplementation(async (...args) => {
      const result = await commit(...args)
      h.advanceTo(expiry)
      return result
    })
    expect((await commitMedusaNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
    expect(h.createOrders).toHaveBeenCalledOnce()
    expect(h.settled).toEqual(["rollback"])
  })

  it.each(["source-read", "ledger-finish", "last-xid-read"] as const)(
    "refuses readback expiry during %s through the owning transaction",
    async (stage) => {
      const h = ownerHarness()
      const expire = () => h.advanceTo(Date.parse(h.readback.expiresAt))
      if (stage === "source-read") {
        const read = h.source.readFinal.getMockImplementation()
        assert.ok(read)
        h.source.readFinal.mockImplementation(async () => {
          const result = await read()
          expire()
          return result
        })
      } else if (stage === "ledger-finish") {
        const commit = h.commit.getMockImplementation()
        assert.ok(commit)
        h.commit.mockImplementation(async (...args) => {
          const result = await commit(...args)
          expire()
          return result
        })
      } else {
        let xidReads = 0
        const raw = h.transaction.raw.getMockImplementation()
        assert.ok(raw)
        h.transaction.raw.mockImplementation(async (sql) => {
          const result = await raw(sql)
          if (sql.includes("pg_current_xact_id") && ++xidReads === 2) expire()
          return result
        })
      }
      expect((await commitMedusaNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
      expect(h.createOrders).toHaveBeenCalledOnce()
      expect(h.settled).toEqual(["rollback"])
    },
  )

  it("refuses context expiry while waiting for the spend lock before native mutation", async () => {
    const h = ownerHarness()
    h.original.context.expires_at = new Date(NOW.getTime() + 1000).toISOString()
    const commit = h.commit.getMockImplementation()
    assert.ok(commit)
    h.commit.mockImplementation(async (...args) => {
      h.advanceTo(NOW.getTime() + 1000)
      return commit(...args)
    })
    expect((await commitMedusaNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
    expect(h.createOrders).not.toHaveBeenCalled()
    expect(h.settled).toEqual(["rollback"])
    expect(h.queries.some((sql) => sql.includes("INSERT"))).toBe(false)
  })

  const originalLeaseCases = (["context", "operation", "buyer", "seller"] as const).flatMap(
    (scope) => (["source-read", "ledger-finish"] as const).map((stage) => ({ scope, stage })),
  )
  it.each(originalLeaseCases)(
    "refuses the original $scope lease expiring during $stage",
    async ({ scope, stage }) => {
      const h = ownerHarness()
      const expiry = new Date(NOW.getTime() + 1000).toISOString()
      if (scope === "context") h.original.context.expires_at = expiry
      if (scope === "operation") h.original.operationDecision.expiresAt = expiry
      if (scope === "buyer") h.original.receipt.expires_at = expiry
      if (scope === "seller") h.original.seller.lease_expires_at = expiry
      if (stage === "source-read") {
        const read = h.source.readFinal.getMockImplementation()
        assert.ok(read)
        h.source.readFinal.mockImplementation(async () => {
          const result = await read()
          h.advanceTo(Date.parse(expiry))
          return result
        })
      } else {
        const commit = h.commit.getMockImplementation()
        assert.ok(commit)
        h.commit.mockImplementation(async (...args) => {
          const result = await commit(...args)
          h.advanceTo(Date.parse(expiry))
          return result
        })
      }
      expect((await commitMedusaNativeBuyerOrder(h.deps, request)).outcome).toBe("REFUSED")
      expect(h.createOrders).toHaveBeenCalledOnce()
      expect(h.settled).toEqual(["rollback"])
      if (stage === "source-read") {
        expect(h.queries.some((sql) => sql.includes("INSERT INTO event_outbox"))).toBe(false)
      }
    },
  )
})
