import type { ExecArgs } from "@medusajs/framework/types"
import { ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID } from "../baobab/context/digital-estates"
import {
  DurableErpIntegrationAdapter,
  assertFinancialProjection,
  erpProjectionDigest,
  reconcileErpProjection,
  type ErpProjectionCommand,
} from "../baobab/erp-integration"
import type ErpIntegrationModuleService from "../modules/erp-integration/service"
export default async function ({ container }: ExecArgs) {
  const erp = container.resolve<ErpIntegrationModuleService>("erpIntegration")
  const mappings = await erp.listErpEntityMappings({
    digital_estate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
  })
  if (
    mappings.filter((item) => item.mapping_type === "PRODUCT").length !== 10 ||
    mappings.filter((item) => item.mapping_type === "WAREHOUSE").length !== 6 ||
    mappings.filter((item) => item.mapping_type === "BUSINESS_PARTNER").length !== 1
  )
    throw new Error("Incomplete Gate 12 foundational ERP mappings")
  const adapter = new DurableErpIntegrationAdapter({
    async findByIdempotencyKey(key) {
      const [item] = await erp.listErpProjections({ source_idempotency_key: key })
      if (!item) return undefined
      return {
        id: item.id,
        commandDigest:
          item.command_digest ??
          erpProjectionDigest({
            kind: item.kind,
            commerceReference: item.commerce_reference,
            canonicalEntityId: item.canonical_entity_id,
            legalSellerKey: item.legal_seller_key,
            marketKey: item.market_key,
            payload: item.payload as Record<string, unknown>,
            idempotencyKey: item.source_idempotency_key,
            correlationId: item.correlation_id,
          }),
      }
    },
    async create(command: ErpProjectionCommand & { commandDigest: string }) {
      return erp.createErpProjections({
        kind: command.kind,
        commerce_reference: command.commerceReference,
        canonical_entity_id: command.canonicalEntityId,
        legal_seller_key: command.legalSellerKey,
        market_key: command.marketKey,
        payload: command.payload,
        status: "PENDING",
        source_idempotency_key: command.idempotencyKey,
        command_digest: command.commandDigest,
        correlation_id: command.correlationId,
      })
    },
  })
  const orderCommand: ErpProjectionCommand = {
    kind: "ORDER",
    commerceReference: "gate12-order",
    canonicalEntityId: "canonical:order:gate12",
    legalSellerKey: "zuribeans-uganda",
    marketKey: "zuribeans_ug",
    payload: {
      business_partner: "gate12-b2b-organisation",
      currency: "UGX",
      total_minor: 1250000,
      lines: [{ product: "ug-arabica-green-aa", warehouse: "UG-KLA-01", quantity: 1 }],
    },
    idempotencyKey: "gate12:order",
    correlationId: "gate12-verification",
  }
  const order = await adapter.queue(orderCommand)
  const replay = await adapter.queue(orderCommand)
  if (replay.id !== order.id) throw new Error("ERP order projection is not idempotent")
  await adapter.queue({
    kind: "FULFILMENT",
    commerceReference: "gate12-fulfilment",
    canonicalEntityId: "canonical:fulfilment:gate12",
    legalSellerKey: "zuribeans-uganda",
    marketKey: "zuribeans_ug",
    payload: {
      order_reference: "gate12-order",
      warehouse: "UG-KLA-01",
      shipment_reference: "gate12-shipment",
    },
    idempotencyKey: "gate12:fulfilment",
    correlationId: "gate12-verification",
  })
  const financial = {
    commercePaymentReference: "gate8-payment-ug-net30",
    erpPaymentReference: "IDEMPIERE:C_Payment:GATE12",
    status: "OPEN" as const,
    amountMinor: 1250000,
    outstandingMinor: 1250000,
    currency: "UGX",
    sourceSequence: 1,
    sourceIdempotencyKey: "gate12:financial:1",
    observedAt: new Date(),
  }
  assertFinancialProjection(null, financial)
  const [existingFinancial] = await erp.listFinancialStatusProjections({
    source_idempotency_key: financial.sourceIdempotencyKey,
  })
  if (!existingFinancial)
    await erp.createFinancialStatusProjections({
      commerce_payment_reference: financial.commercePaymentReference,
      erp_payment_reference: financial.erpPaymentReference,
      status: financial.status,
      amount_minor: financial.amountMinor,
      outstanding_minor: financial.outstandingMinor,
      currency_code: financial.currency,
      source_sequence: financial.sourceSequence,
      source_idempotency_key: financial.sourceIdempotencyKey,
      observed_at: financial.observedAt,
      applied_at: new Date(),
    })
  const reconciliation = reconcileErpProjection({
    expected: { status: "PENDING", currency: "UGX" },
  })
  const [existingRec] = await erp.listErpReconciliations({
    source_idempotency_key: "gate12:reconcile:order",
  })
  if (!existingRec)
    await erp.createErpReconciliations({
      projection_kind: "ORDER",
      commerce_reference: "gate12-order",
      expected_state: { status: "PENDING", currency: "UGX" },
      differences: reconciliation.differences,
      status: reconciliation.status,
      source_idempotency_key: "gate12:reconcile:order",
      observed_at: new Date(),
    })
  container
    .resolve("logger")
    .info(
      "Verified Gate 12 mappings, Order/Fulfilment queues, financial status, idempotency, and reconciliation",
    )
}
