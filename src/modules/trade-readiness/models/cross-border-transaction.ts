import { model } from "@medusajs/framework/utils"
const CrossBorderTransaction = model.define(
  { name: "cross_border_transaction", tableName: "cross_border_transaction" },
  {
    id: model.id({ prefix: "xborder" }).primaryKey(),
    transaction_reference: model.text().unique(),
    order_reference: model.text().index(),
    market_key: model.text(),
    legal_seller_key: model.text(),
    exporter_organisation_id: model.text(),
    importer_organisation_id: model.text(),
    origin_country: model.text(),
    destination_country: model.text(),
    incoterm: model.text(),
    customs_procedure_reference: model.text(),
    export_eligibility_reference: model.text(),
    exporter_registration_reference: model.text(),
    importer_registration_reference: model.text(),
    customs_declaration_reference: model.text().nullable(),
    export_permit_reference: model.text().nullable(),
    trade_lines: model.json(),
    compliance_decision_id: model.text(),
    status: model.enum(["READY", "REVIEW_REQUIRED", "BLOCKED"]).default("READY"),
    source_idempotency_key: model.text().unique(),
    correlation_id: model.text(),
  },
)
export default CrossBorderTransaction
