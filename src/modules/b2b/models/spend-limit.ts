import { model } from "@medusajs/framework/utils"

const SpendLimit = model
  .define(
    { name: "spend_limit", tableName: "b2b_spend_limit" },
    {
      id: model.id({ prefix: "b2blim" }).primaryKey(),
      membership_id: model.text().index(),
      market_key: model.text().index().nullable(),
      currency_code: model.text(),
      order_limit_minor: model.bigNumber().nullable(),
      approval_limit_minor: model.bigNumber().nullable(),
      effective_from: model.dateTime().nullable(),
      effective_until: model.dateTime().nullable(),
    },
  )
  .indexes([{ on: ["membership_id", "market_key", "currency_code"], unique: true }])

export default SpendLimit
