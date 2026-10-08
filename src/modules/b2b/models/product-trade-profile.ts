import { model } from "@medusajs/framework/utils"

/**
 * Commerce-side trade metadata for a Medusa product (Gate ZB-06 / ADR-0011 / ADR-0030).
 * Not a canonical product master; not Shared SaaS product/v1.
 */
const ProductTradeProfile = model.define(
  { name: "product_trade_profile", tableName: "b2b_product_trade_profile" },
  {
    id: model.id({ prefix: "b2bprod" }).primaryKey(),
    /** Medusa product id — commerce projection key (ADR-0011). */
    product_id: model.text().unique(),
    /** External correlation key for CP CanonicalEntity PRODUCT; not minted here. */
    canonical_product_key: model.text().unique(),
    country_of_origin: model.text(),
    /** Reference only — not authoritative customs eligibility (ADR-0024 §9). */
    hs_classification_reference: model.text(),
    classification_system: model.text().default("HS"),
    classification_confidence: model
      .enum(["PROPOSED", "UNDER_REVIEW", "VERIFIED", "AUTHORITATIVE", "DISPUTED", "EXPIRED"])
      .default("PROPOSED"),
    commodity_category: model.text(),
    /** Extensible trade unit of measure code (API-validated, not coffee-hardcoded). */
    trade_uom: model.text(),
    net_weight_kg: model.float().nullable(),
    gross_weight_kg: model.float().nullable(),
    packaging: model.text().nullable(),
    lot_controlled: model.boolean().default(true),
    batch_controlled: model.boolean().default(true),
    export_eligibility_reference: model.text().nullable(),
    commodity_attributes: model.json().nullable(),
  },
)

export default ProductTradeProfile
