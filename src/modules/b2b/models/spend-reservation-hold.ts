import { model } from "@medusajs/framework/utils"

/**
 * ADR-SHARED-042 section 14, Decision 5 (Migration20261022150000).
 * What one reservation holds against one budget period. Read-only here: only the ledger trigger writes it.
 */
const SpendReservationHold = model.define(
  { name: "spend_reservation_hold", tableName: "b2b_spend_reservation_hold" },
  {
    id: model.id({ prefix: "b2bhold" }).primaryKey(),
    reservation_id: model.text().index(),
    budget_policy_id: model.text().index(),
    policy_revision: model.number(),
    period_starts_at: model.dateTime(),
    reserved_minor: model.bigNumber(),
    committed_minor: model.bigNumber(),
  },
)

export default SpendReservationHold
