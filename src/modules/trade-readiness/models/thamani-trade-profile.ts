import { model } from "@medusajs/framework/utils"

const ThamaniTradeProfile = model
  .define(
    { name: "thamani_trade_profile", tableName: "thamani_trade_profile" },
    {
      id: model.id({ prefix: "thtrade" }).primaryKey(),
      canonical_product_key: model.text().index(),
      market_key: model.text().index(),
      origin_country: model.text(),
      hs_classification_reference: model.text(),
      hs_classification_status: model.enum(["VERIFIED", "UNVERIFIED"]),
      customs_tariff_reference: model.text(),
      landed_cost_reference: model.text(),
      source: model.text(),
      reviewed_at: model.dateTime().nullable(),
    },
  )
  .indexes([{ on: ["canonical_product_key", "market_key"], unique: true }])

export default ThamaniTradeProfile
