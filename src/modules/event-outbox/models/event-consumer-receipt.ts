import { model } from "@medusajs/framework/utils"
const EventConsumerReceipt = model.define(
  { name: "event_consumer_receipt", tableName: "event_consumer_receipt" },
  {
    id: model.id({ prefix: "evtrec" }).primaryKey(),
    consumer_name: model.text(),
    event_id: model.text(),
    event_type: model.text(),
    correlation_id: model.text().index(),
    processed_at: model.dateTime(),
  },
)
export default EventConsumerReceipt
