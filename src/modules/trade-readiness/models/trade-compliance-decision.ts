import { model } from "@medusajs/framework/utils"
const TradeComplianceDecision = model.define(
  { name: "trade_compliance_decision", tableName: "trade_compliance_decision" },
  {
    id: model.id({ prefix: "trdec" }).primaryKey(),
    decision_reference: model.text().unique(),
    transaction_reference: model.text().index(),
    status: model.enum(["APPROVED", "REJECTED", "REVIEW_REQUIRED"]),
    policy_reference: model.text(),
    policy_version: model.text(),
    reasons: model.json(),
    decided_at: model.dateTime(),
    expires_at: model.dateTime().nullable(),
    source: model.text(),
    source_idempotency_key: model.text().unique(),
    correlation_id: model.text(),
  },
)
export default TradeComplianceDecision
