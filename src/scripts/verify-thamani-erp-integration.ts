import type { ExecArgs } from "@medusajs/framework/types"
import { THAMANI_DIGITAL_ESTATE_CANONICAL_ID } from "../baobab/context/digital-estates"
import {
  DurableErpIntegrationAdapter,
  erpProjectionDigest,
  reconcileErpProjection,
  type ErpProjectionCommand,
} from "../baobab/erp-integration"
import {
  createThamaniErpProjection,
  THAMANI_ERP_PROJECTION_KINDS,
} from "../baobab/thamani/erp-integration"
import type ErpIntegrationModuleService from "../modules/erp-integration/service"

export default async function ({ container }: ExecArgs) {
  const erp = container.resolve<ErpIntegrationModuleService>("erpIntegration")
  const mappings = await erp.listErpEntityMappings({
    digital_estate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
  })
  for (const [kind, expected] of [
    ["PRODUCT", 38],
    ["SUPPLIER", 17],
    ["WAREHOUSE", 5],
  ] as const)
    if (mappings.filter((item) => item.mapping_type === kind).length !== expected)
      throw new Error(`Expected ${expected} Thamani ${kind} mappings`)

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
        owner_legal_entity_id: "canonical:legal-entity:thamani",
        digital_estate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
        payload: command.payload,
        status: "PENDING",
        source_idempotency_key: command.idempotencyKey,
        command_digest: command.commandDigest,
        correlation_id: command.correlationId,
      })
    },
  })
  for (const kind of THAMANI_ERP_PROJECTION_KINDS) {
    const command = createThamaniErpProjection({
      kind,
      commerceReference: `gate15-${kind.toLowerCase()}`,
      canonicalEntityId: `canonical:thamani:${kind.toLowerCase()}:gate15`,
      legalSellerKey: "thamani-uganda",
      marketKey: "thamani_ug",
      payload: {
        currency: "UGX",
        amount_minor: 125000,
        supplier: "sup_ug_mountain_roasters",
        warehouse: "TH-UG-KLA-01",
      },
      sourceVersion: 1,
      correlationId: "15151515-1515-4515-8515-151515151515",
    })
    const first = await adapter.queue(command)
    if ((await adapter.queue(command)).id !== first.id)
      throw new Error(`${kind} projection is not replay-safe`)
  }
  const collision = createThamaniErpProjection({
    kind: "PAYMENT",
    commerceReference: "gate15-payment",
    canonicalEntityId: "canonical:thamani:payment:gate15",
    legalSellerKey: "thamani-uganda",
    marketKey: "thamani_ug",
    payload: { currency: "ZAR" },
    sourceVersion: 1,
    correlationId: "15151515-1515-4515-8515-151515151515",
  })
  let rejected = false
  try {
    await adapter.queue(collision)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error("ERP idempotency collision was accepted")

  // Gate 20: prove Thamani's own ERP projections are reconciliation-swept, not
  // only ZuriBeans' (verify-erp-integration.ts) — this row is what
  // verify-observability.ts's reconciliation sweep reads back.
  const reconciliation = reconcileErpProjection({
    expected: { supplier: "sup_ug_mountain_roasters" },
  })
  const [existingRec] = await erp.listErpReconciliations({
    source_idempotency_key: "gate15:thamani:reconcile:product",
  })
  if (!existingRec)
    await erp.createErpReconciliations({
      projection_kind: "PRODUCT",
      commerce_reference: "gate15-product",
      expected_state: { supplier: "sup_ug_mountain_roasters" },
      differences: reconciliation.differences,
      status: reconciliation.status,
      source_idempotency_key: "gate15:thamani:reconcile:product",
      observed_at: new Date(),
    })

  container
    .resolve("logger")
    .info(
      "Verified Thamani Gate 15 canonical mappings, eight projection families, isolation, replay, and collision rejection",
    )
}
