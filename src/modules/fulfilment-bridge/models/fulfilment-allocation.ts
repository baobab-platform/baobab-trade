import { model } from "@medusajs/framework/utils"
const FulfilmentAllocation = model.define(
  { name: "fulfilment_allocation", tableName: "fulfilment_allocation" },
  {
    id: model.id({ prefix: "fulalloc" }).primaryKey(),
    fulfilment_id: model.text().index(),
    order_line_reference: model.text().index(),
    source_location_key: model.text().index(),
    quantity: model.number(),
    source_idempotency_key: model.text().unique(),
  },
)
export default FulfilmentAllocation
