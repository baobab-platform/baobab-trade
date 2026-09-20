import { model } from "@medusajs/framework/utils"

const BuyerApplication = model
  .define(
    { name: "buyer_application", tableName: "b2b_buyer_application" },
    {
      id: model.id({ prefix: "b2bapp" }).primaryKey(),
      tenant_id: model.text().index(),
      applicant_customer_id: model.text().index(),
      applicant_principal_id: model.text().index().nullable(),
      idempotency_key: model.text(),
      request_hash: model.text(),
      legal_name: model.text(),
      trading_name: model.text().nullable(),
      registration_number: model.text().nullable(),
      country_of_registration: model.text().nullable(),
      website: model.text().nullable(),
      requested_market_keys: model.json(),
      status: model
        .enum([
          "DRAFT",
          "SUBMITTED",
          "INFORMATION_REQUIRED",
          "UNDER_REVIEW",
          "APPROVED",
          "REJECTED",
          "WITHDRAWN",
        ])
        .default("DRAFT"),
      revision: model.number().default(1),
      submitted_at: model.dateTime().nullable(),
      assigned_reviewer_principal_id: model.text().nullable(),
    },
  )
  .indexes([
    { on: ["tenant_id", "applicant_customer_id"] },
    { on: ["tenant_id", "idempotency_key"], unique: true },
  ])

export default BuyerApplication
