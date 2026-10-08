import { model } from "@medusajs/framework/utils"

const PaymentReconciliation = model.define(
  { name: "payment_reconciliation", tableName: "payment_erp_reconciliation" },
  {
    id: model.id({ prefix: "payrec" }).primaryKey(),
    payment_id: model.text().index(),
    erp_payment_reference: model.text().nullable(),
    commerce_status: model.text(),
    erp_status: model.text().nullable(),
    commerce_amount_minor: model.bigNumber(),
    erp_amount_minor: model.bigNumber().nullable(),
    commerce_currency: model.text(),
    erp_currency: model.text().nullable(),
    amount_delta_minor: model.bigNumber(),
    status: model.enum(["MATCHED", "VARIANCE", "PENDING_ERP", "RESOLVED"]),
    reasons: model.json(),
    source_idempotency_key: model.text().unique(),
    observed_at: model.dateTime(),
    resolved_at: model.dateTime().nullable(),
    resolution_note: model.text().nullable(),
  },
)

export default PaymentReconciliation
