import { model } from "@medusajs/framework/utils"

const PaymentWebhookReceipt = model
  .define(
    { name: "payment_webhook_receipt", tableName: "payment_webhook_receipt" },
    {
      id: model.id({ prefix: "payhook" }).primaryKey(),
      provider_key: model.text().index(),
      provider_event_id: model.text(),
      payload_sha256: model.text(),
      signature_verified: model.boolean(),
      occurred_at: model.dateTime(),
      processed_at: model.dateTime().nullable(),
      processing_status: model.enum(["RECEIVED", "PROCESSED", "REJECTED"]).default("RECEIVED"),
      rejection_reason: model.text().nullable(),
    },
  )
  .indexes([{ on: ["provider_key", "provider_event_id"], unique: true }])

export default PaymentWebhookReceipt
