import { model } from "@medusajs/framework/utils"

const CommercePayment = model.define(
  { name: "commerce_payment", tableName: "commerce_payment" },
  {
    id: model.id({ prefix: "pay" }).primaryKey(),
    digital_estate: model.text(),
    payment_reference: model.text().unique(),
    order_reference: model.text().index(),
    organisation_id: model.text().index().nullable(),
    customer_reference: model.text().index().nullable(),
    market_key: model.text().index(),
    legal_seller_key: model.text(),
    method: model.enum(["BANK_TRANSFER", "MANUAL_SETTLEMENT", "INVOICE_TERMS", "SELECTED_PSP"]),
    terms: model.enum(["PREPAID", "DUE_ON_RECEIPT", "NET_7", "NET_14", "NET_30"]),
    provider_key: model.text(),
    provider_reference: model.text().nullable(),
    provider_status: model.text().nullable(),
    currency_code: model.text(),
    amount_minor: model.bigNumber(),
    status: model.enum([
      "CREATED",
      "PENDING",
      "AUTHORIZED",
      "CAPTURED",
      "SETTLED",
      "FAILED",
      "CANCELLED",
      "UNKNOWN",
    ]),
    source_idempotency_key: model.text().unique(),
    correlation_id: model.text(),
    due_at: model.dateTime().nullable(),
  },
)

export default CommercePayment
