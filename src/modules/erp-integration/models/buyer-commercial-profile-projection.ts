import { model } from "@medusajs/framework/utils"

const BuyerCommercialProfileProjection = model
  .define(
    {
      name: "buyer_commercial_profile_projection",
      tableName: "erp_buyer_commercial_profile_projection",
    },
    {
      id: model.id({ prefix: "erpbcp" }).primaryKey(),
      buyer_organisation_id: model.text().index(),
      tenant_id: model.text().index(),
      legal_entity_id: model.text().index(),
      business_partner_id: model.text().index(),
      credit_status: model.enum(["APPROVED", "ON_HOLD", "REJECTED"]),
      payment_term_code: model.text().nullable(),
      credit_limit_minor: model.bigNumber().nullable(),
      currency_code: model.text(),
      profile_reference: model.text(),
      source_event_id: model.text().unique(),
      source_correlation_id: model.text().index(),
      observed_at: model.dateTime(),
      applied_at: model.dateTime(),
    },
  )
  .indexes([
    {
      on: ["buyer_organisation_id", "profile_reference", "source_event_id"],
      unique: true,
    },
  ])

export default BuyerCommercialProfileProjection
