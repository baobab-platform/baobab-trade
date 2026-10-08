import { model } from "@medusajs/framework/utils"
const FulfilmentStatusTransition = model
  .define(
    { name: "fulfilment_status_transition", tableName: "fulfilment_status_transition" },
    {
      id: model.id({ prefix: "fultr" }).primaryKey(),
      fulfilment_id: model.text().index(),
      from_status: model.text(),
      to_status: model.text(),
      idempotency_key: model.text(),
      evidence: model.json(),
      occurred_at: model.dateTime(),
    },
  )
  .indexes([{ on: ["fulfilment_id", "idempotency_key"], unique: true }])
export default FulfilmentStatusTransition
