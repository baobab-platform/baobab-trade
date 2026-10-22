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
      // ADR-SHARED-042 section 5 (Migration20261022090000): the Trade engine
      // instance this relationship belongs to, its database-owned revision and
      // the provenance of the canonical Organisation link.
      engine_instance_id: model.text().nullable(),
      relationship_revision: model.number().default(1),
      link_provenance: model.text().nullable(),
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
