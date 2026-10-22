import { model } from "@medusajs/framework/utils"

/**
 * ADR-SHARED-042 section 14, Decision 5 (Migration20261022150000).
 * Versioned budget (MEMBERSHIP monthly, AGREEMENT term, ORGANISATION monthly). The database owns the revision.
 */
const SpendBudgetPolicy = model.define(
  { name: "spend_budget_policy", tableName: "b2b_spend_budget_policy" },
  {
    id: model.id({ prefix: "b2bbud" }).primaryKey(),
    revision: model.number().default(1),
    status: model.enum(["ACTIVE", "SUSPENDED", "RETIRED"]).default("ACTIVE"),
    scope: model.enum(["MEMBERSHIP", "AGREEMENT", "ORGANISATION"]),
    tenant_id: model.text(),
    organisation_id: model.text().index(),
    membership_id: model.text().index().nullable(),
    agreement_reference: model.text().nullable(),
    market_key: model.text(),
    currency_code: model.text(),
    period_kind: model.enum(["CALENDAR_MONTH", "AGREEMENT_TERM"]),
    timezone: model.text().default("UTC"),
    limit_minor: model.bigNumber(),
    effective_from: model.dateTime(),
    effective_until: model.dateTime().nullable(),
    evidence_reference: model.text(),
  },
)

export default SpendBudgetPolicy
