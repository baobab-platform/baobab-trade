import { model } from "@medusajs/framework/utils"
const B2BTaxProfile = model
  .define(
    { name: "b2b_tax_profile", tableName: "b2b_tax_profile" },
    {
      id: model.id({ prefix: "b2btax" }).primaryKey(),
      organisation_id: model.text().index(),
      jurisdiction_key: model.text(),
      registration_reference: model.text().nullable(),
      verification_status: model.enum(["VERIFIED", "UNVERIFIED", "EXPIRED", "REJECTED"]),
      verified_at: model.dateTime().nullable(),
      verification_expires_at: model.dateTime().nullable(),
      verification_source: model.text().nullable(),
      eligible_treatments: model.json(),
      exemption_reason: model.text().nullable(),
      provenance: model.json(),
    },
  )
  .indexes([{ on: ["organisation_id", "jurisdiction_key"], unique: true }])
export default B2BTaxProfile
