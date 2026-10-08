import { model } from "@medusajs/framework/utils"

const PurchaseApproval = model.define(
  { name: "purchase_approval", tableName: "b2b_purchase_approval" },
  {
    id: model.id({ prefix: "b2bapr" }).primaryKey(),
    organisation_id: model.text().index(),
    requested_by_membership_id: model.text().index(),
    decided_by_membership_id: model.text().index().nullable(),
    cart_id: model.text().index().nullable(),
    order_id: model.text().index().nullable(),
    status: model.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).default("PENDING"),
    amount_minor: model.bigNumber(),
    currency_code: model.text(),
    reason: model.text(),
    decision_note: model.text().nullable(),
    decided_at: model.dateTime().nullable(),
  },
)

export default PurchaseApproval
