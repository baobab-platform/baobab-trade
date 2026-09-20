import { model } from "@medusajs/framework/utils"

const BuyerInvitationDelivery = model
  .define(
    { name: "buyer_invitation_delivery", tableName: "b2b_buyer_invitation_delivery" },
    {
      id: model.id({ prefix: "b2binvdel" }).primaryKey(),
      membership_id: model.text().index(),
      attempt_number: model.number(),
      status: model.enum(["PENDING", "QUEUED", "FAILED"]),
      requested_by_principal_id: model.text().index(),
      idempotency_key: model.text().unique(),
      request_hash: model.text(),
      provider_message_id: model.text().nullable(),
      error_code: model.text().nullable(),
      attempted_at: model.dateTime(),
    },
  )
  .indexes([{ on: ["membership_id", "attempt_number"], unique: true }])

export default BuyerInvitationDelivery
