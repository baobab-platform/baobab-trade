import { model } from "@medusajs/framework/utils"

const BuyerRole = model
  .define(
    { name: "buyer_role", tableName: "b2b_buyer_role" },
    {
      id: model.id({ prefix: "b2brole" }).primaryKey(),
      membership_id: model.text().index(),
      role: model.enum([
        "BUYER",
        "SENIOR_BUYER",
        "APPROVER",
        "PROCUREMENT_MANAGER",
        "ACCOUNT_ADMIN",
        "VIEWER",
      ]),
      assigned_by_principal_id: model.text().nullable(),
    },
  )
  .indexes([{ on: ["membership_id", "role"], unique: true }])

export default BuyerRole
