import { model } from "@medusajs/framework/utils"

const FulfilmentOrderLine = model.define(
  { name: "fulfilment_order_line", tableName: "fulfilment_order_line" },
  {
    id: model.id({ prefix: "fulline" }).primaryKey(),
    fulfilment_id: model.text().index(),
    order_line_reference: model.text().index(),
    fulfilled_quantity: model.number(),
    returned_quantity: model.number().default(0),
  },
)

export default FulfilmentOrderLine
