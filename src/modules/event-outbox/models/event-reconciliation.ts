import { model } from "@medusajs/framework/utils"
const EventReconciliation = model.define(
  { name: "event_reconciliation", tableName: "event_reconciliation" },
  {
    id: model.id({ prefix: "evtrecon" }).primaryKey(),
    outbox_id: model.text().index(),
    event_id: model.text().index(),
    status: model.enum(["MATCHED", "PENDING", "RETRY_DUE", "ACTION_REQUIRED", "RESOLVED"]),
    reason: model.text().nullable(),
    source_idempotency_key: model.text().unique(),
    observed_at: model.dateTime(),
    resolved_at: model.dateTime().nullable(),
    resolution_note: model.text().nullable(),
  },
)
export default EventReconciliation
