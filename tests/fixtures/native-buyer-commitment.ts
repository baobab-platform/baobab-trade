import type {
  AuthorizedCommitment,
  NativeCommitRequest,
  NativeErpOrderConsequence,
} from "../../src/baobab/b2b/native-buyer-commitment"
import { buildFinalBuyerCommitmentValuation } from "../../src/baobab/b2b/buyer-commitment-valuation"

/**
 * CAA-06b shared synthetic UNIT fixture. The transaction stub does not
 * certify Medusa persistence or ERP consequences: those require the separate
 * real PostgreSQL, Medusa, RabbitMQ and iDempiere connected acceptance.
 */
export const NOW = new Date("2026-11-04T16:00:15.000Z")
const transactionDigest = "sha256:" + "9".repeat(64)
const sellerId = "3f9a1c2e-7b4d-4e8a-9c1f-2d6e5b4a3c21"
const principal = "019a0915-a8c0-7000-8000-000000000001"
const contextId = "5b1e9c3a-7d2f-4a6e-9b1c-3e5f7a9d1b20"
const decisionId = "8c2f4a6e-1b3d-4e5f-9a7c-0d1e2f3a4b5c"
const receiptId = "7d3e5f1a-2b4c-4d6e-8f0a-1b2c3d4e5f60"
export const eventId = "22222222-2222-4222-8222-222222222222"
const operationReference = "trade/trade.order.commit/cart_synthetic01/4/1"
export const valuationFacts = {
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
export const request: NativeCommitRequest = {
  nativeOrderId: "order_synthetic01",
  idempotencyKey: "native.buyer.00000001",
  correlationId: tenant.correlationId,
  tenant,
}

export function syntheticCommitmentProof(): AuthorizedCommitment {
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
      market_id: "zuribeans_ug",
      resource_id: valuation.resource_id,
      resource_version: valuation.resource_version,
      transaction_digest: transactionDigest,
      amount_minor: valuation.buyer_commitment_amount_minor,
      currency: valuation.currency,
      valuation_digest: valuation.valuation_digest,
      seller_legal_entity_id: "SYNTHETIC-LE-01",
      seller_binding_reference: { binding_id: sellerId, binding_version: 2 },
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
    valuation: structuredClone(valuation),
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

/** Synthetic business facts only; not native order readback. */
export function syntheticErpConsequence(): NativeErpOrderConsequence {
  return {
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
  }
}
