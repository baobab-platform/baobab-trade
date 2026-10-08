import { model } from "@medusajs/framework/utils"

const ApprovalPolicy = model
  .define(
    { name: "approval_policy", tableName: "b2b_approval_policy" },
    {
      id: model.id({ prefix: "b2bapol" }).primaryKey(),
      organisation_id: model.text().index(),
      market_key: model.text().index().nullable(),
      currency_code: model.text(),
      threshold_minor: model.bigNumber().nullable(),
      enabled: model.boolean().default(true),
      product_category_ids: model.array().default([]),
    },
  )
  .indexes([{ on: ["organisation_id", "market_key"], unique: true }])

export default ApprovalPolicy
