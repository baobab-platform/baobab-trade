import { model } from "@medusajs/framework/utils"
const ErpEntityMapping = model
  .define(
    { name: "erp_entity_mapping", tableName: "erp_entity_mapping" },
    {
      id: model.id({ prefix: "erpmap" }).primaryKey(),
      digital_estate: model.text(),
      mapping_type: model.enum([
        "BUSINESS_PARTNER",
        "PRODUCT",
        "WAREHOUSE",
        "SALES_ORDER",
        "SHIPMENT",
        "FINANCIAL_CONSEQUENCE",
        "SUPPLIER",
        "PAYMENT",
        "RETURN_REFUND",
      ]),
      canonical_entity_id: model.text().index(),
      medusa_entity_type: model.text(),
      medusa_native_id: model.text(),
      erp_entity_type: model.text(),
      erp_native_id: model.text(),
      external_reference: model.text().unique(),
      source_authority: model.enum(["CONTROL_PLANE", "ERP", "TRADE_PENDING_REGISTRATION"]),
      status: model.enum(["ACTIVE", "UNVERIFIED", "SUSPECT", "ARCHIVED"]).default("UNVERIFIED"),
    },
  )
  .indexes([
    { on: ["mapping_type", "digital_estate", "canonical_entity_id"], unique: true },
    { on: ["erp_entity_type", "erp_native_id"], unique: true },
  ])
export default ErpEntityMapping
