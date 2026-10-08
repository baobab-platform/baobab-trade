import { model } from "@medusajs/framework/utils"

const PurchaseOrderRequirement = model
  .define(
    { name: "purchase_order_requirement", tableName: "b2b_purchase_order_requirement" },
    {
      id: model.id({ prefix: "b2bpor" }).primaryKey(),
      organisation_id: model.text().index(),
      market_key: model.text().index().nullable(),
      required: model.boolean().default(true),
      format_pattern: model.text().nullable(),
      description: model.text().nullable(),
    },
  )
  .indexes([{ on: ["organisation_id", "market_key"], unique: true }])

export default PurchaseOrderRequirement
