import { model } from "@medusajs/framework/utils"

const BuyerApplicationEvidence = model
  .define(
    { name: "buyer_application_evidence", tableName: "b2b_buyer_application_evidence" },
    {
      id: model.id({ prefix: "b2bevd" }).primaryKey(),
      application_id: model.text().index(),
      tenant_id: model.text().index(),
      evidence_type: model.enum([
        "COMPANY_REGISTRATION",
        "TAX_REGISTRATION",
        "AUTHORIZED_REPRESENTATIVE",
        "REGISTERED_ADDRESS",
        "OWNERSHIP_STRUCTURE",
        "BANK_ACCOUNT",
        "OTHER",
      ]),
      canonical_document_id: model.text().index(),
      document_version: model.text(),
      content_sha256: model.text(),
      media_type: model.text(),
      size_bytes: model.bigNumber(),
      issued_at: model.dateTime().nullable(),
      expires_at: model.dateTime().nullable(),
      status: model.enum(["PENDING", "VERIFIED", "REJECTED", "SUPERSEDED"]).default("PENDING"),
      submitted_by_customer_id: model.text().index(),
      submitted_by_principal_id: model.text().nullable(),
      idempotency_key: model.text(),
      request_hash: model.text(),
      submitted_at: model.dateTime(),
    },
  )
  .indexes([
    { on: ["tenant_id", "idempotency_key"], unique: true },
    { on: ["application_id", "canonical_document_id", "document_version"], unique: true },
  ])

export default BuyerApplicationEvidence
