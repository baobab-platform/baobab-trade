import { model } from "@medusajs/framework/utils"

/**
 * ADR-SHARED-042 section 14, Decision 5 (Migration20261022150000).
 * Append-only RESERVE / COMMIT / RELEASE. The database stamps occurred_at, derives the period and moves the balance.
 */
const SpendLedgerEntry = model.define(
  { name: "spend_ledger_entry", tableName: "b2b_spend_ledger_entry" },
  {
    id: model.id({ prefix: "b2bled" }).primaryKey(),
    entry_kind: model.enum(["RESERVE", "COMMIT", "RELEASE"]),
    reservation_id: model.text().index(),
    budget_policy_id: model.text().index(),
    policy_revision: model.number(),
    period_starts_at: model.dateTime().nullable(),
    period_ends_at: model.dateTime().nullable(),
    amount_minor: model.bigNumber(),
    commitment_reference: model.text().nullable(),
    release_reason: model
      .enum([
        "REJECTED",
        "CANCELLED",
        "EXPIRED",
        "AMOUNT_REDUCED",
        "PERIOD_ROLLOVER",
        "POLICY_REVISED",
      ])
      .nullable(),
    idempotency_key: model.text().unique(),
    actor_principal_id: model.text(),
    occurred_at: model.dateTime(),
  },
)

export default SpendLedgerEntry
