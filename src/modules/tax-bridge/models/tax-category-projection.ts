import { model } from "@medusajs/framework/utils"

const TaxCategoryProjection = model
  .define(
    { name: "tax_category_projection", tableName: "tax_category_projection" },
    {
      id: model.id({ prefix: "taxcat" }).primaryKey(),
      market_key: model.text().index(),
      category_key: model.text(),
      treatment: model.enum(["STANDARD", "ZERO_RATED", "EXEMPT"]),
      rule_reference: model.text().nullable(),
      verification_status: model.enum(["VERIFIED", "REVIEW_REQUIRED"]),
      source_authority: model.text().nullable(),
      source_retrieved_at: model.dateTime(),
    },
  )
  .indexes([{ on: ["market_key", "category_key"], unique: true }])

export default TaxCategoryProjection
