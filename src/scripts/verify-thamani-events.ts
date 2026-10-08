import type { ExecArgs } from "@medusajs/framework/types"
import { isValidCloudEvent, type BaobabCloudEvent } from "../baobab/events"
import { assertNoPersonalData, assertNoSensitiveEventData } from "../baobab/security"
import { ERP_INTEGRATION_MODULE } from "../modules/erp-integration"
import type ErpIntegrationModuleService from "../modules/erp-integration/service"
import type EventOutboxModuleService from "../modules/event-outbox/service"

/**
 * ADR-SHARED-018 §8.5: the Thamani ERP projection commands
 * (com.nabhold.commerce.thamani-*.projection-requested.v1) are retired.
 * Thamani ERP projections are still recorded, and the erp_projection
 * trigger still enforces their invariants, but no command event is
 * enqueued. Any Thamani-scoped outbox row that remains must be a canonical,
 * scope-correct, privacy-safe event, and every retired command that was
 * still unpublished is dead-lettered, never published.
 */
export default async function ({ container }: ExecArgs) {
  const erp = container.resolve<ErpIntegrationModuleService>(ERP_INTEGRATION_MODULE)
  const projections = (await erp.listErpProjections({})).filter((projection) =>
    String(projection.source_idempotency_key).startsWith("thamani:erp:"),
  )
  if (projections.length === 0)
    throw new Error("No Thamani ERP projections found; run bootstrap:thamani-erp-integration first")

  const service = container.resolve<EventOutboxModuleService>("eventOutbox")
  const rows = await service.listEventOutboxes({
    tenant_id: "tenant-thamani",
    owner_legal_entity_id: "canonical:legal-entity:thamani",
    digital_estate: "estate:thamani-b2c",
  })

  for (const row of rows) {
    if (String(row.event_type).startsWith("com.nabhold.")) {
      if (row.status !== "PUBLISHED" && row.status !== "DEAD_LETTER")
        throw new Error(`Retired legacy command ${row.event_id} is still queued (${row.status})`)
      if (row.status === "DEAD_LETTER" && row.last_error_code !== "RETIRED_ADR_SHARED_018")
        throw new Error(
          `Retired legacy command ${row.event_id} was dead-lettered for another reason`,
        )
      continue
    }
    const envelope = row.envelope as BaobabCloudEvent
    if (!isValidCloudEvent(envelope)) throw new Error(`Invalid canonical envelope ${row.event_id}`)
    if (envelope.baobabscope !== "tenant" || envelope.tenantid !== "tenant-thamani")
      throw new Error("Cross-tenant envelope detected")
    if (/thamani-[a-z-]+\.projection-requested/.test(envelope.type))
      throw new Error(`Estate-named projection command ${envelope.type} must not be emitted`)
    assertNoPersonalData(envelope.data)
    assertNoSensitiveEventData(envelope.data)
  }

  const retired = rows.filter((row) => String(row.event_type).startsWith("com.nabhold."))
  container
    .resolve("logger")
    .info(
      `Verified ADR-SHARED-018 §8.5: ${projections.length} Thamani ERP projections recorded without projection commands (${retired.length} retired legacy rows kept as history)`,
    )
}
