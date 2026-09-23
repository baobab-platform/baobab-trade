import { model } from "@medusajs/framework/utils"

/**
 * MOQ / multiple constraints per variant and market (Gate ZB-06).
 * trade_uom is an extensible code — aligned with product trade profile (ADR-0030).
 */
const PurchaseConstraint = model
  .define(
    { name: "purchase_constraint", tableName: "b2b_purchase_constraint" },
    {
      id: model.id({ prefix: "b2bqty" }).primaryKey(),
      variant_id: model.text().index(),
      market_key: model.text().index(),
      minimum_order_quantity: model.number(),
      order_multiple: model.number(),
      trade_uom: model.text(),
    },
  )
  .indexes([{ on: ["variant_id", "market_key"], unique: true }])

export default PurchaseConstraint
