import { model } from "@medusajs/framework/utils"

const BuyerMembership = model
  .define(
    { name: "buyer_membership", tableName: "b2b_buyer_membership" },
    {
      id: model.id({ prefix: "b2bmem" }).primaryKey(),
      organisation_id: model.text().index(),
      customer_id: model.text().index().nullable(),
      principal_id: model.text().index().nullable(),
      status: model.enum(["INVITED", "ACTIVE", "SUSPENDED", "REVOKED"]).default("INVITED"),
      invited_email: model.text().nullable(),
      invitation_token_hash: model.text().unique().nullable(),
      invitation_idempotency_key: model.text().unique().nullable(),
      invitation_request_hash: model.text().nullable(),
      invitation_expires_at: model.dateTime().nullable(),
      invitation_accepted_at: model.dateTime().nullable(),
      effective_from: model.dateTime().nullable(),
      effective_until: model.dateTime().nullable(),
    },
  )
  .indexes([
    { on: ["organisation_id", "customer_id"], unique: true },
    { on: ["organisation_id", "principal_id"] },
  ])

export default BuyerMembership
