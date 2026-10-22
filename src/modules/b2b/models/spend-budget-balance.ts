import { model } from "@medusajs/framework/utils"

/**
 * ADR-SHARED-042 section 14, Decision 5 (Migration20261022150000).
 * Committed and reserved totals of one budget period. Read-only here: only the ledger trigger writes it.
 */
const SpendBudgetBalance = model.define(
  { name: "spend_budget_balance", tableName: "b2b_spend_budget_balance" },
  {
    id: model.id({ prefix: "b2bbal" }).primaryKey(),
    budget_policy_id: model.text().index(),
    period_starts_at: model.dateTime(),
    period_ends_at: model.dateTime(),
    committed_minor: model.bigNumber(),
    reserved_minor: model.bigNumber(),
  },
)

export default SpendBudgetBalance
