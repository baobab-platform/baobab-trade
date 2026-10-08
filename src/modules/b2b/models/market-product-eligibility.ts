import { model } from "@medusajs/framework/utils"

/**
 * Market assortment + regulatory gate for a product (Gate ZB-06 / ADR-0024 / ADR-0030).
 * Commercial status and regulatory eligibility are deliberately separate.
 */
const MarketProductEligibility = model
  .define(
    { name: "market_product_eligibility", tableName: "b2b_market_product_eligibility" },
    {
      id: model.id({ prefix: "b2belig" }).primaryKey(),
      product_id: model.text().index(),
      market_key: model.text().index(),
      /** Assortment activation — not regulatory permission. */
      status: model.enum(["ACTIVE", "SUSPENDED", "WITHDRAWN"]).default("ACTIVE"),
      /** Regulatory eligibility (ADR-0024 §19). */
      regulatory_eligibility: model
        .enum([
          "NOT_EVALUATED",
          "PENDING",
          "ELIGIBLE",
          "ELIGIBLE_WITH_CONDITIONS",
          "REVIEW_REQUIRED",
          "INELIGIBLE",
          "SUSPENDED",
          "EXPIRED",
          "ERROR",
        ])
        .default("NOT_EVALUATED"),
      policy_reference: model.text().nullable(),
      effective_from: model.dateTime().nullable(),
      effective_until: model.dateTime().nullable(),
    },
  )
  .indexes([{ on: ["product_id", "market_key"], unique: true }])

export default MarketProductEligibility
