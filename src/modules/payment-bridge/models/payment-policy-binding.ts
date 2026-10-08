import { model } from "@medusajs/framework/utils"

const PaymentPolicyBinding = model
  .define(
    { name: "payment_policy_binding", tableName: "payment_policy_binding" },
    {
      id: model.id({ prefix: "paypol" }).primaryKey(),
      market_key: model.text().index(),
      legal_seller_key: model.text(),
      currency_code: model.text(),
      default_terms: model.text(),
      allowed_terms: model.json(),
      provider_bindings: model.json(),
      status: model.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
    },
  )
  .indexes([{ on: ["market_key", "currency_code"], unique: true }])

export default PaymentPolicyBinding
