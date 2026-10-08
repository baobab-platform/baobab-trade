import { model } from "@medusajs/framework/utils"
const ErpReconciliation = model.define(
  { name: "erp_reconciliation", tableName: "erp_integration_reconciliation" },
  {
    id: model.id({ prefix: "erprec" }).primaryKey(),
    projection_kind: model.enum([
      "BUSINESS_PARTNER",
      "PRODUCT",
      "WAREHOUSE",
      "ORDER",
      "FULFILMENT",
      "FINANCIAL_STATUS",
      "SUPPLIER",
      "SHIPMENT",
      "PAYMENT",
      "RETURN_REFUND",
    ]),
    commerce_reference: model.text().index(),
    erp_reference: model.text().nullable(),
    expected_state: model.json(),
    observed_state: model.json().nullable(),
    differences: model.json(),
    status: model.enum(["MATCHED", "VARIANCE", "PENDING_ERP", "RESOLVED"]),
    source_idempotency_key: model.text().unique(),
    observed_at: model.dateTime(),
    resolved_at: model.dateTime().nullable(),
    resolution_note: model.text().nullable(),
  },
)
export default ErpReconciliation
