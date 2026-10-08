import { model } from "@medusajs/framework/utils"

const PaymentRefund = model.define(
  { name: "payment_refund", tableName: "payment_refund" },
  {
    id: model.id({ prefix: "payref" }).primaryKey(),
    refund_reference: model.text().unique(),
    payment_id: model.text().index(),
    order_reference: model.text().index(),
    provider_key: model.text(),
    provider_reference: model.text().nullable(),
    currency_code: model.text(),
    amount_minor: model.bigNumber(),
    reason: model.enum(["CUSTOMER_RETURN", "ORDER_CANCELLATION", "SERVICE_RECOVERY"]),
    status: model.enum(["REQUESTED", "SUBMITTED", "SUCCEEDED", "FAILED"]),
    source_idempotency_key: model.text().unique(),
    correlation_id: model.text(),
    failure_code: model.text().nullable(),
  },
)

export default PaymentRefund
