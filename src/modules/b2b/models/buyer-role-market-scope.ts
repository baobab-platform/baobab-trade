import { model } from "@medusajs/framework/utils"

/**
 * ADR-SHARED-042 section 14, CAA-05: a Market grant bound to one role assignment
 * (Migration20261022120000). The database owns the revision; REVOKED is terminal.
 */
const BuyerRoleMarketScope = model
  .define(
    { name: "buyer_role_market_scope", tableName: "b2b_buyer_role_market_scope" },
    {
      id: model.id({ prefix: "b2bmkt" }).primaryKey(),
      buyer_role_id: model.text().index(),
      market_key: model.text().index(),
      status: model.enum(["ACTIVE", "SUSPENDED", "REVOKED"]).default("ACTIVE"),
      effective_from: model.dateTime().nullable(),
      effective_until: model.dateTime().nullable(),
      revision: model.number().default(1),
      granted_by_principal_id: model.text(),
      evidence_reference: model.text(),
      revoked_at: model.dateTime().nullable(),
      revoked_by_principal_id: model.text().nullable(),
      revocation_reason: model.text().nullable(),
    },
  )
  .indexes([{ on: ["buyer_role_id", "market_key"], unique: true }])

export default BuyerRoleMarketScope
