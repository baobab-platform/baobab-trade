import { model } from "@medusajs/framework/utils"

const CreditTerms = model
  .define(
    { name: "credit_terms", tableName: "b2b_credit_terms" },
    {
      id: model.id({ prefix: "b2bcred" }).primaryKey(),
      organisation_id: model.text().index(),
      market_key: model.text().index().nullable(),
      currency_code: model.text(),
      payment_terms_code: model.text(),
      payment_due_days: model.number(),
      projected_credit_limit_minor: model.bigNumber().nullable(),
      authority: model.enum(["ERP", "CONTRACT", "MANUAL"]).default("ERP"),
      source_reference: model.text().nullable(),
      effective_from: model.dateTime().nullable(),
      effective_until: model.dateTime().nullable(),
    },
  )
  .indexes([{ on: ["organisation_id", "market_key", "currency_code"], unique: true }])

export default CreditTerms
