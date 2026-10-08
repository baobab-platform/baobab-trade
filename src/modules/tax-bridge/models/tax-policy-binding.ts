import { model } from "@medusajs/framework/utils"
const TaxPolicyBinding = model
  .define(
    { name: "tax_policy_binding", tableName: "tax_policy_binding" },
    {
      id: model.id({ prefix: "taxpol" }).primaryKey(),
      market_key: model.text().index(),
      jurisdiction_key: model.text(),
      currency_code: model.text(),
      legal_seller_key: model.text(),
      provider_key: model.text(),
      seller_registration_reference: model.text(),
      prices_include_tax: model.boolean(),
      fail_closed: model.boolean(),
      status: model.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
    },
  )
  .indexes([{ on: ["market_key", "legal_seller_key"], unique: true }])
export default TaxPolicyBinding
