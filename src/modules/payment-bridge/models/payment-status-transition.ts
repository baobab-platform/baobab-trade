import { model } from "@medusajs/framework/utils"

const PaymentStatusTransition = model.define(
  { name: "payment_status_transition", tableName: "payment_status_transition" },
  {
    id: model.id({ prefix: "paytr" }).primaryKey(),
    payment_id: model.text().index(),
    from_status: model.text(),
    to_status: model.text(),
    idempotency_key: model.text().unique(),
    provider_reference: model.text().nullable(),
    provider_status: model.text().nullable(),
    occurred_at: model.dateTime(),
  },
)

export default PaymentStatusTransition
