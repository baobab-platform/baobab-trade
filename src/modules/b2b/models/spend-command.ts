import { model } from "@medusajs/framework/utils"

/**
 * ADR-SHARED-042 section 14, Decision 5 / CAA-06 (Migration20261022180000).
 * One applied spend reservation command and its original result. Append-only.
 */
const SpendCommand = model.define(
  { name: "spend_command", tableName: "b2b_spend_command" },
  {
    id: model.id({ prefix: "b2bcmd" }).primaryKey(),
    idempotency_key: model.text().unique(),
    command_kind: model.enum(["SUBMIT", "RESUBMIT", "COMMIT", "RELEASE", "EXPIRE", "ROLLOVER"]),
    organisation_id: model.text(),
    request_digest: model.text(),
    reservation_id: model.text().index(),
    result: model.json(),
    actor_principal_id: model.text(),
  },
)

export default SpendCommand
