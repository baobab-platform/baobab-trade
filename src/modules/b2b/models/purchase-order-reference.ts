import { model } from "@medusajs/framework/utils"

const PurchaseOrderReference = model
  .define(
    { name: "purchase_order_reference", tableName: "b2b_purchase_order_reference" },
    {
      id: model.id({ prefix: "b2bporef" }).primaryKey(),
      organisation_id: model.text().index(),
      submitted_by_membership_id: model.text().index(),
      customer_po_number: model.text(),
      cart_id: model.text().unique().nullable(),
      order_id: model.text().unique().nullable(),
      status: model.enum(["DRAFT", "COMMITTED", "CANCELLED"]).default("DRAFT"),
    },
  )
  .indexes([{ on: ["organisation_id", "customer_po_number"], unique: true }])

export default PurchaseOrderReference
