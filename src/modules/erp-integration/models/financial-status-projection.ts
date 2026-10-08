import { model } from "@medusajs/framework/utils"
const FinancialStatusProjection = model
  .define(
    { name: "financial_status_projection", tableName: "erp_financial_status_projection" },
    {
      id: model.id({ prefix: "erpfin" }).primaryKey(),
      commerce_payment_reference: model.text().index(),
      erp_payment_reference: model.text(),
      status: model.enum(["OPEN", "PARTIALLY_PAID", "PAID", "OVERDUE", "CREDIT_HOLD", "CANCELLED"]),
      amount_minor: model.bigNumber(),
      outstanding_minor: model.bigNumber(),
      currency_code: model.text(),
      source_sequence: model.number(),
      source_idempotency_key: model.text().unique(),
      observed_at: model.dateTime(),
      applied_at: model.dateTime().nullable(),
    },
  )
  .indexes([{ on: ["commerce_payment_reference", "source_sequence"], unique: true }])
export default FinancialStatusProjection
