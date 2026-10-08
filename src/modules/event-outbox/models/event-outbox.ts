import { model } from "@medusajs/framework/utils"
const EventOutbox = model.define(
  { name: "event_outbox", tableName: "event_outbox" },
  {
    id: model.id({ prefix: "evtout" }).primaryKey(),
    event_id: model.text().unique(),
    event_type: model.text().index(),
    subject: model.text().index(),
    tenant_id: model.text().index().nullable(),
    owner_legal_entity_id: model.text().index().nullable(),
    digital_estate: model.text().index().nullable(),
    market_key: model.text().index().nullable(),
    envelope_digest: model.text().nullable(),
    correlation_id: model.text().index(),
    causation_id: model.text().nullable(),
    idempotency_key: model.text().unique(),
    envelope: model.json(),
    status: model
      .enum(["PENDING", "PUBLISHING", "PUBLISHED", "RETRY", "DEAD_LETTER"])
      .default("PENDING"),
    attempt_count: model.number().default(0),
    next_attempt_at: model.dateTime(),
    published_at: model.dateTime().nullable(),
    lease_expires_at: model.dateTime().nullable(),
    last_error_code: model.text().nullable(),
  },
)
export default EventOutbox
