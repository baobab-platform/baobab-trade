import { model } from "@medusajs/framework/utils"

/**
 * ADR-SHARED-042 section 14, Decision 5 (Migration20261022150000).
 * One formally submitted, immutable purchase. Its binding never changes; non-ACTIVE states are terminal.
 */
const SpendReservation = model.define(
  { name: "spend_reservation", tableName: "b2b_spend_reservation" },
  {
    id: model.id({ prefix: "b2bres" }).primaryKey(),
    tenant_id: model.text(),
    organisation_id: model.text().index(),
    membership_id: model.text().index(),
    submitted_by_principal_id: model.text(),
    market_key: model.text(),
    currency_code: model.text(),
    agreement_reference: model.text().nullable(),
    transaction_digest: model.text(),
    resource_version: model.number(),
    status: model.enum(["ACTIVE", "COMMITTED", "RELEASED", "EXPIRED"]).default("ACTIVE"),
    expires_at: model.dateTime(),
  },
)

export default SpendReservation
