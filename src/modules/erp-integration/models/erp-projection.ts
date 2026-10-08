import { model } from "@medusajs/framework/utils"
const ErpProjection = model.define(
  { name: "erp_projection", tableName: "erp_projection" },
  {
    id: model.id({ prefix: "erpproj" }).primaryKey(),
    kind: model.enum([
      "PRODUCT",
      "SUPPLIER",
      "WAREHOUSE",
      "ORDER",
      "FULFILMENT",
      "SHIPMENT",
      "PAYMENT",
      "RETURN_REFUND",
    ]),
    commerce_reference: model.text().index(),
    canonical_entity_id: model.text(),
    legal_seller_key: model.text(),
    market_key: model.text(),
    owner_legal_entity_id: model.text().index().nullable(),
    digital_estate: model.text().index().nullable(),
    payload: model.json(),
    status: model
      .enum(["PENDING", "PUBLISHED", "ACKNOWLEDGED", "FAILED", "RECONCILIATION_REQUIRED"])
      .default("PENDING"),
    erp_reference: model.text().nullable(),
    attempt_count: model.number().default(0),
    last_error_code: model.text().nullable(),
    next_attempt_at: model.dateTime().nullable(),
    source_idempotency_key: model.text().unique(),
    command_digest: model.text().nullable(),
    correlation_id: model.text(),
    acknowledged_at: model.dateTime().nullable(),
  },
)
export default ErpProjection
