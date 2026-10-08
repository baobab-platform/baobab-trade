import { model } from "@medusajs/framework/utils"

const TaxRegistration = model
  .define(
    { name: "tax_registration", tableName: "b2b_tax_registration" },
    {
      id: model.id({ prefix: "b2btax" }).primaryKey(),
      organisation_id: model.text().index(),
      market_key: model.text().index(),
      country_code: model.text(),
      registration_type: model.enum(["VAT", "TIN", "IMPORTER", "EXPORTER", "OTHER"]),
      registration_number: model.text(),
      status: model.enum(["PENDING", "VERIFIED", "REJECTED", "EXPIRED"]).default("PENDING"),
      verified_at: model.dateTime().nullable(),
      expires_at: model.dateTime().nullable(),
    },
  )
  .indexes([
    {
      on: ["organisation_id", "market_key", "registration_type", "registration_number"],
      unique: true,
    },
  ])

export default TaxRegistration
