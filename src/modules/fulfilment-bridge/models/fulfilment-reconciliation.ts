import { model } from "@medusajs/framework/utils"
const FulfilmentReconciliation = model.define(
  { name: "fulfilment_reconciliation", tableName: "fulfilment_reconciliation" },
  {
    id: model.id({ prefix: "fulrec" }).primaryKey(),
    fulfilment_id: model.text().index(),
    execution_reference: model.text().nullable(),
    commerce_status: model.text(),
    execution_status: model.text().nullable(),
    status: model.enum(["MATCHED", "VARIANCE", "PENDING_EXECUTION", "RESOLVED"]),
    reasons: model.json(),
    source_idempotency_key: model.text().unique(),
    observed_at: model.dateTime(),
    resolved_at: model.dateTime().nullable(),
    resolution_note: model.text().nullable(),
  },
)
export default FulfilmentReconciliation
