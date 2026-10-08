import { model } from "@medusajs/framework/utils"
const TradeLanePolicy = model
  .define(
    { name: "trade_lane_policy", tableName: "trade_lane_policy" },
    {
      id: model.id({ prefix: "trlane" }).primaryKey(),
      digital_estate: model.text(),
      policy_reference: model.text(),
      policy_version: model.text(),
      origin_country: model.text().index(),
      destination_country: model.text().index(),
      permitted_incoterms: model.json(),
      permitted_trade_uoms: model.json(),
      effective_from: model.dateTime(),
      effective_until: model.dateTime().nullable(),
      source: model.text(),
      status: model.enum(["ACTIVE", "SUPERSEDED", "REVOKED"]).default("ACTIVE"),
    },
  )
  .indexes([{ on: ["digital_estate", "policy_reference", "policy_version"], unique: true }])
export default TradeLanePolicy
