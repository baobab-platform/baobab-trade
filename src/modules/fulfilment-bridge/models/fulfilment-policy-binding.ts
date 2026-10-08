import { model } from "@medusajs/framework/utils"
const FulfilmentPolicyBinding = model
  .define(
    { name: "fulfilment_policy_binding", tableName: "fulfilment_policy_binding" },
    {
      id: model.id({ prefix: "fulpol" }).primaryKey(),
      market_key: model.text().index(),
      country_code: model.text(),
      legal_seller_key: model.text(),
      provider_bindings: model.json(),
      status: model.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
    },
  )
  .indexes([{ on: ["market_key"], unique: true }])
export default FulfilmentPolicyBinding
