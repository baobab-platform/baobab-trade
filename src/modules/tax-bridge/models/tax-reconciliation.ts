import { model } from "@medusajs/framework/utils"
const TaxReconciliation = model.define(
  { name: "tax_reconciliation", tableName: "tax_reconciliation" },
  {
    id: model.id({ prefix: "taxrec" }).primaryKey(),
    determination_id: model.text().index(),
    erp_tax_reference: model.text().nullable(),
    commerce_tax_minor: model.bigNumber(),
    erp_tax_minor: model.bigNumber().nullable(),
    commerce_currency: model.text(),
    erp_currency: model.text().nullable(),
    delta_minor: model.bigNumber(),
    status: model.enum(["MATCHED", "VARIANCE", "PENDING_ERP", "RESOLVED"]),
    reasons: model.json(),
    source_idempotency_key: model.text().unique(),
    observed_at: model.dateTime(),
    resolved_at: model.dateTime().nullable(),
    resolution_note: model.text().nullable(),
  },
)
export default TaxReconciliation
