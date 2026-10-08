import { model } from "@medusajs/framework/utils"

const MarketProductEligibility = model
  .define(
    {
      name: "thamani_market_product_eligibility",
      tableName: "thamani_market_product_eligibility",
    },
    {
      id: model.id({ prefix: "thamelig" }).primaryKey(),
      product_id: model.text().index(),
      market_key: model.text().index(),
      status: model.enum(["ACTIVE", "SUSPENDED", "WITHDRAWN"]).default("ACTIVE"),
      policy_reference: model.text(),
    },
  )
  .indexes([{ on: ["product_id", "market_key"], unique: true }])

export default MarketProductEligibility
