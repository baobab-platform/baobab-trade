import { model } from "@medusajs/framework/utils"
const TaxRuleProjection = model
  .define(
    { name: "tax_rule_projection", tableName: "tax_rule_projection" },
    {
      id: model.id({ prefix: "taxrule" }).primaryKey(),
      digital_estate: model.text(),
      rule_reference: model.text(),
      rule_version: model.text(),
      jurisdiction_key: model.text().index(),
      product_tax_classification: model.text(),
      transaction_type: model.enum(["GOODS", "SHIPPING", "DISCOUNT", "RETURN", "REFUND"]),
      treatment: model.enum(["STANDARD", "ZERO_RATED", "EXEMPT", "REVERSE_CHARGE"]),
      rate_basis_points: model.number(),
      legal_reason: model.text().nullable(),
      effective_from: model.dateTime(),
      effective_until: model.dateTime().nullable(),
      source_authority: model.text(),
      source_retrieved_at: model.dateTime(),
      status: model.enum(["ACTIVE", "SUPERSEDED", "REVOKED"]).default("ACTIVE"),
    },
  )
  .indexes([{ on: ["digital_estate", "rule_reference", "rule_version"], unique: true }])
export default TaxRuleProjection
