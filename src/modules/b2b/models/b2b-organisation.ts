import { model } from "@medusajs/framework/utils"

const B2BOrganisation = model
  .define(
    { name: "b2b_organisation", tableName: "b2b_organisation" },
    {
      id: model.id({ prefix: "b2borg" }).primaryKey(),
      tenant_id: model.text().index(),
      legal_name: model.text(),
      trading_name: model.text().nullable(),
      registration_number: model.text().nullable(),
      status: model.enum(["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"]).default("PENDING"),
      canonical_organisation_id: model.text().index().nullable(),
      erp_business_partner_id: model.text().index().nullable(),
      default_market_key: model.text().nullable(),
    },
  )
  .indexes([
    {
      on: ["tenant_id", "registration_number"],
      unique: true,
      where: { registration_number: { $ne: null } },
    },
  ])

export default B2BOrganisation
