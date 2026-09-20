import { model } from "@medusajs/framework/utils"

const BuyerApplicationDecision = model
  .define(
    { name: "buyer_application_decision", tableName: "b2b_buyer_application_decision" },
    {
      id: model.id({ prefix: "b2bdec" }).primaryKey(),
      application_id: model.text().index(),
      decision: model.enum(["APPROVED", "REJECTED"]),
      decided_by_principal_id: model.text().index(),
      decision_reference: model.text().unique(),
      reason_code: model.text(),
      canonical_organisation_id: model.text().nullable(),
      buyer_organisation_id: model.text().nullable(),
      idempotency_key: model.text().unique(),
      request_hash: model.text(),
      decided_at: model.dateTime(),
    },
  )
  .indexes([{ on: ["application_id"], unique: true }])

export default BuyerApplicationDecision
