import { model } from "@medusajs/framework/utils"

const BuyerApplicationEvidenceDecision = model
  .define(
    {
      name: "buyer_application_evidence_decision",
      tableName: "b2b_buyer_application_evidence_decision",
    },
    {
      id: model.id({ prefix: "b2bevdec" }).primaryKey(),
      application_id: model.text().index(),
      evidence_id: model.text().index(),
      tenant_id: model.text().index(),
      decision: model.enum(["VERIFIED", "REJECTED"]),
      reviewer_principal_id: model.text().index(),
      decision_reference: model.text(),
      reason_code: model.text(),
      note: model.text().nullable(),
      idempotency_key: model.text(),
      request_hash: model.text(),
      decided_at: model.dateTime(),
    },
  )
  .indexes([
    { on: ["evidence_id"], unique: true },
    { on: ["tenant_id", "idempotency_key"], unique: true },
  ])

export default BuyerApplicationEvidenceDecision
