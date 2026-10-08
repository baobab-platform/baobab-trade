import { model } from "@medusajs/framework/utils"
const CommerceReturn = model.define(
  { name: "commerce_return", tableName: "commerce_return" },
  {
    id: model.id({ prefix: "ret" }).primaryKey(),
    return_reference: model.text().unique(),
    fulfilment_id: model.text().index(),
    order_reference: model.text().index(),
    order_line_reference: model.text().index(),
    quantity: model.number(),
    reason: model.enum(["DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CUSTOMER_REMORSE"]),
    disposition: model.enum(["RESTOCK", "QUARANTINE", "DISPOSE", "INSPECT"]),
    status: model.enum(["REQUESTED", "AUTHORIZED", "RECEIVED", "COMPLETED", "REJECTED"]),
    source_idempotency_key: model.text().unique(),
    correlation_id: model.text(),
  },
)
export default CommerceReturn
