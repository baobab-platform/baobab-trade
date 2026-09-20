import { model } from "@medusajs/framework/utils"

const BuyerApplicationReviewAction = model
  .define(
    {
      name: "buyer_application_review_action",
      tableName: "b2b_buyer_application_review_action",
    },
    {
      id: model.id({ prefix: "b2brev" }).primaryKey(),
      application_id: model.text().index(),
      tenant_id: model.text().index(),
      from_status: model.enum(["SUBMITTED", "UNDER_REVIEW"]),
      to_status: model.enum(["INFORMATION_REQUIRED", "UNDER_REVIEW"]),
      reviewer_principal_id: model.text().index(),
      reason_code: model.text(),
      note: model.text().nullable(),
      application_revision: model.number(),
      idempotency_key: model.text(),
      request_hash: model.text(),
      action_at: model.dateTime(),
    },
  )
  .indexes([
    { on: ["application_id", "application_revision"], unique: true },
    { on: ["tenant_id", "idempotency_key"], unique: true },
  ])

export default BuyerApplicationReviewAction
