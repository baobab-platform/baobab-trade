import { describe, expect, it, vi } from "vitest"
import {
  commitAuthorizedNativeBuyerOrder,
  type AuthorizedCommitment,
  type NativeCommitDependencies,
  type NativeCommitRequest,
} from "../src/baobab/b2b/native-buyer-commitment"
import { buildFinalBuyerCommitmentValuation } from "../src/baobab/b2b/buyer-commitment-valuation"
import type { PgClient } from "../src/baobab/orders/postgres-governed-binding-persistence"

/**
 * CAA-06b contract-join UNIT regressions. The transaction stub does not
 * certify Medusa persistence or ERP consequences: those require the separate
 * real PostgreSQL, Medusa, RabbitMQ and iDempiere connected acceptance.
 */
const NOW = new Date("2026-11-04T16:00:15.000Z")
const transactionDigest = "sha256:" + "9".repeat(64)
const sellerId = "3f9a1c2e-7b4d-4e8a-9c1f-2d6e5b4a3c21"
const principal = "019a0915-a8c0-7000-8000-000000000001"
const contextId = "5b1e9c3a-7d2f-4a6e-9b1c-3e5f7a9d1b20"
const decisionId = "8c2f4a6e-1b3d-4e5f-9a7c-0d1e2f3a4b5c"
const receiptId = "7d3e5f1a-2b4c-4d6e-8f0a-1b2c3d4e5f60"
const eventId = "22222222-2222-4222-8222-222222222222"
const operationReference = "trade/trade.order.commit/cart_synthetic01/4/1"
const valuationFacts = {
  resource_id: "cart_synthetic01",
  resource_version: 4,
  transaction_digest: transactionDigest,
  currency: "UGX",
  basis: "FINAL_PRICED" as const,
  components: [
    {
      component_kind: "MERCHANDISE" as const,
      amount_minor: 1250000,
      determination: "FINAL" as const,
      source_reference: "line_1",
    },
  ],
}
const valuation = buildFinalBuyerCommitmentValuation(valuationFacts, NOW)
const tenant = {
  tenantId: "tn_synthetic01",
  entityId: "SYNTHETIC-LE-01",
  lifecycleStatus: "active" as const,
  productId: "baobab-trade",
  entitled: true as const,
  entitlementTier: null,
  cacheTtlSeconds: 10,
  resolvedAt: NOW.toISOString(),
  correlationId: "0b6f2c1e-6d0a-4f43-9c1a-2f1d6b1e9a40",
}
const request: NativeCommitRequest = {
  nativeOrderId: "order_synthetic01",
  idempotencyKey: "native.buyer.00000001",
  correlationId: tenant.correlationId,
  tenant,
}

function proof(): AuthorizedCommitment {
  return {
    context: {
      context_id: contextId,
      decision_id: decisionId,
      correlation_id: tenant.correlationId,
      actor_type: "HUMAN",
      actor_principal_id: principal,
      external_identity_id: "019a0915-a8c0-7000-8000-000000000002",
      tenant_id: tenant.tenantId,
      digital_estate_id: "zuribeans",
      engine_instance_id: "ei_tradestaging01",
      canonical_organisation_id: "2c8e4f6a-1b3d-4e5f-8a7c-9d0e1f2a3b4c",
      buyer_organisation_id: "b2borg_synthetic01",
      buyer_membership_id: "b2bmem_synthetic01",
      membership_revision: 3,
      roles: ["BUYER"],
      cp_context_id: "6f1c2a9e-4b7d-4c1e-9a3f-2d5e8b7c1a40",
      operation: "trade.order.commit",
      policy_revision: "trade-buyer-policy:2026-11-04.1",
      decision: { outcome: "ALLOW", reasons: [] },
      evaluated_at: "2026-11-04T16:00:00Z",
      expires_at: "2026-11-04T16:00:30Z",
      evidence_references: ["synthetic:cp-principal-resolution/01"],
    },
    operationDecision: {
      outcome: "ALLOW",
      decisionId,
      operation: "trade.order.commit",
      principalId: principal,
      transactionDigest,
      amountMinor: valuation.buyer_commitment_amount_minor,
      resourceVersion: valuation.resource_version,
      evaluatedAt: "2026-11-04T16:00:00Z",
      expiresAt: "2026-11-04T16:00:30Z",
    },
    valuation,
    receipt: {
      receipt_id: receiptId,
      context_id: contextId,
      decision_id: decisionId,
      correlation_id: tenant.correlationId,
      operation: "trade.order.commit",
      operation_reference: operationReference,
      actor_principal_id: principal,
      tenant_id: tenant.tenantId,
      canonical_organisation_id: "2c8e4f6a-1b3d-4e5f-8a7c-9d0e1f2a3b4c",
      buyer_organisation_id: "b2borg_synthetic01",
      buyer_membership_id: "b2bmem_synthetic01",
      membership_revision: 3,
      market_id: "zuribeans_ug",
      resource_id: valuation.resource_id,
      resource_version: valuation.resource_version,
      transaction_digest: valuation.transaction_digest,
      amount_minor: valuation.buyer_commitment_amount_minor,
      currency: valuation.currency,
      valuation_digest: valuation.valuation_digest,
      policy_revision: "trade-buyer-policy:2026-11-04.1",
      approval_references: [],
      spend_reservation_id: "b2bres_synthetic0001",
      spend_hold_revision: 1,
      seller_legal_entity_id: "SYNTHETIC-LE-01",
      seller_binding_reference: { binding_id: sellerId, binding_version: 2 },
      evaluated_at: "2026-11-04T16:00:00Z",
      expires_at: "2026-11-04T16:00:30Z",
      evidence_references: ["synthetic:cp-principal-resolution/01"],
    },
    seller: {
      receipt_id: "6c2d5e8b-4f1a-4b3c-9e2d-1f3a5b7c9d00",
      attribution_id: "5c2d5e8b-4f1a-4b3c-9e2d-1f3a5b7c9d00",
      operation_class: "trade.order.commit",
      operation_reference: operationReference,
      decision_id: "6c2d5e8b-4f1a-4b3c-9e2d-1f3a5b7c9d01",
      binding_id: sellerId,
      binding_version: 2,
      native_configuration_digest: "9".repeat(64),
      currency: "UGX",
      context_id: "6f1c2a9e-4b7d-4c1e-9a3f-2d5e8b7c1a40",
      tenant_id: tenant.tenantId,
      operating_organisation_id: "2c8e4f6a-1b3d-4e5f-8a7c-9d0e1f2a3b4c",
      market: "UG",
      mandate_id: "7d2b9e4f-6a1c-4f3e-b8d5-0c9a8e7f6d21",
      responsible_legal_entity_id: "SYNTHETIC-LE-01",
      policy_reference: "ADR-SHARED-039/v1",
      evaluated_at: "2026-11-04T16:00:00Z",
      received_at: "2026-11-04T16:00:01Z",
      lease_expires_at: "2026-11-04T16:00:30Z",
    },
  }
}

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
      readErpConsequence: async () => ({
        legal_entity_id: "SYNTHETIC-LE-01",
        commerce_order_id: request.nativeOrderId,
        order_version: 1,
        customer_id: "customer_synthetic01",
        placed_at: NOW.toISOString(),
        currency: "UGX",
        lines: [
          {
            line_id: "line_1",
            sku_id: "sku_1",
            quantity: { value: "1", unit: "EA" },
            unit_price: { amount: "1250000", currency: "UGX" },
            line_total: { amount: "1250000", currency: "UGX" },
          },
        ],
        totals: {
          subtotal: { amount: "1250000", currency: "UGX" },
          discount: { amount: "0", currency: "UGX" },
          quoted_tax: { amount: "0", currency: "UGX" },
          grand_total: { amount: "1250000", currency: "UGX" },
        },
      }),
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
