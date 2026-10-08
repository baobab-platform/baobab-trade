import type { ExecArgs } from "@medusajs/framework/types"
import { createTenantTradeEvent, isValidCloudEvent } from "../baobab/events"
import type EventOutboxModuleService from "../modules/event-outbox/service"

export default async function ({ container }: ExecArgs) {
  const service = container.resolve<EventOutboxModuleService>("eventOutbox")
  const event = createTenantTradeEvent(
    {
      tenantId: "tenant-zuribeans",
      entityId: "canonical:legal-entity:zuribeans",
      lifecycleStatus: "active",
      productId: "baobab-trade",
      entitled: true,
      entitlementTier: null,
      cacheTtlSeconds: 60,
      resolvedAt: "2026-09-08T00:00:00.000Z",
      correlationId: "11111111-1111-4111-8111-111111111111",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      type: "com.baobab-platform.trade.order.placed.v1",
      subject: "commerce-order/gate13-order",
      time: "2026-09-08T00:00:00.000Z",
      dataschema:
        "https://contracts.baobab-platform.com/erp/v1/commerce-order-consequence.schema.json",
      correlationid: "11111111-1111-4111-8111-111111111111",
      causationid: "33333333-3333-4333-8333-333333333333",
      idempotencykey: "gate13:trade-order:placed",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      data: {
        canonical_entity_id: "canonical:order:gate13",
        commerce_reference: "gate13-order",
        projection_kind: "ORDER",
        projection_status: "PENDING",
      },
    },
  )
  if (!isValidCloudEvent(event)) throw new Error("Gate 13 canonical event is invalid")

  const existing = await service.listEventOutboxes({ idempotency_key: event.idempotencykey })
  const outbox =
    existing[0] ??
    (await service.createEventOutboxes({
      event_id: event.id,
      event_type: event.type,
      subject: event.subject,
      tenant_id: event.tenantid,
      correlation_id: event.correlationid,
      causation_id: event.causationid,
      idempotency_key: event.idempotencykey,
      envelope: event,
      status: "PENDING",
      attempt_count: 0,
      next_attempt_at: new Date(),
    }))
  const replay = await service.listEventOutboxes({ idempotency_key: event.idempotencykey })
  if (replay.length !== 1 || replay[0].id !== outbox.id)
    throw new Error("Transactional outbox idempotency failed")
  if (
    replay[0].correlation_id !== event.correlationid ||
    replay[0].causation_id !== event.causationid
  )
    throw new Error("Outbox lost correlation or causation metadata")

  await service.updateEventOutboxes({
    id: outbox.id,
    status: "PUBLISHED",
    attempt_count: 1,
    published_at: new Date(),
  })
  const receipts = await service.listEventConsumerReceipts({
    consumer_name: "gate13-idempiere-order",
    event_id: event.id,
  })
  if (!receipts[0])
    await service.createEventConsumerReceipts({
      consumer_name: "gate13-idempiere-order",
      event_id: event.id,
      event_type: event.type,
      correlation_id: event.correlationid,
      processed_at: new Date(),
    })
  const receiptReplay = await service.listEventConsumerReceipts({
    consumer_name: "gate13-idempiere-order",
    event_id: event.id,
  })
  if (receiptReplay.length !== 1) throw new Error("Consumer receipt idempotency failed")

  const reconciliations = await service.listEventReconciliations({
    source_idempotency_key: "gate13:reconcile:erp-order",
  })
  if (!reconciliations[0])
    await service.createEventReconciliations({
      outbox_id: outbox.id,
      event_id: event.id,
      status: "MATCHED",
      source_idempotency_key: "gate13:reconcile:erp-order",
      observed_at: new Date(),
    })
  container
    .resolve("logger")
    .info("Verified Gate 13 outbox, canonical envelope, consumer receipt, and reconciliation")
}
