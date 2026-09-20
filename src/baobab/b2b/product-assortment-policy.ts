/**
 * Gate ZB-06 sellability composition (ADR-0011 §34, ADR-0024, ADR-0030).
 * Pure functions — no product-name branching.
 */

export type CommercialAssortmentStatus = "ACTIVE" | "SUSPENDED" | "WITHDRAWN"

export type RegulatoryEligibility =
  | "NOT_EVALUATED"
  | "PENDING"
  | "ELIGIBLE"
  | "ELIGIBLE_WITH_CONDITIONS"
  | "REVIEW_REQUIRED"
  | "INELIGIBLE"
  | "SUSPENDED"
  | "EXPIRED"
  | "ERROR"

export type ClassificationConfidence =
  | "PROPOSED"
  | "UNDER_REVIEW"
  | "VERIFIED"
  | "AUTHORITATIVE"
  | "DISPUTED"
  | "EXPIRED"

/** Commercial assortment active in a market. */
export const isAssortmentActive = (status: CommercialAssortmentStatus): boolean =>
  status === "ACTIVE"

/**
 * Regulatory states that may allow a commercial offer when policy accepts
 * conditions. NOT_EVALUATED / PENDING / REVIEW fail closed for automated sell.
 */
export const isRegulatoryBlocking = (eligibility: RegulatoryEligibility): boolean =>
  eligibility === "INELIGIBLE" ||
  eligibility === "SUSPENDED" ||
  eligibility === "EXPIRED" ||
  eligibility === "ERROR" ||
  eligibility === "NOT_EVALUATED" ||
  eligibility === "PENDING" ||
  eligibility === "REVIEW_REQUIRED"

export const isRegulatoryPermissive = (eligibility: RegulatoryEligibility): boolean =>
  eligibility === "ELIGIBLE" || eligibility === "ELIGIBLE_WITH_CONDITIONS"

/**
 * Minimal composition for “may present as sellable in this market” excluding
 * inventory, price, and customer eligibility (ADR-0011 §34 remainder).
 */
export const isMarketAssortmentSellable = (input: {
  assortmentStatus: CommercialAssortmentStatus
  regulatoryEligibility: RegulatoryEligibility
  requireRegulatoryClearance?: boolean
}): boolean => {
  if (!isAssortmentActive(input.assortmentStatus)) return false
  if (input.requireRegulatoryClearance === false) {
    return !isRegulatoryBlocking(input.regulatoryEligibility) ||
      input.regulatoryEligibility === "NOT_EVALUATED"
  }
  return isRegulatoryPermissive(input.regulatoryEligibility)
}

/** HS / classification reference is never by itself trade permission. */
export const classificationAllowsAutomatedTrade = (
  confidence: ClassificationConfidence,
): boolean => confidence === "VERIFIED" || confidence === "AUTHORITATIVE"

const KNOWN_TRADE_UOMS = new Set([
  "BAG",
  "CARTON",
  "KG",
  "TONNE",
  "LITRE",
  "BOTTLE",
  "PALLET",
  "CASE",
  "DRUM",
  "OTHER",
])

export const isKnownTradeUom = (code: string): boolean =>
  KNOWN_TRADE_UOMS.has(code.trim().toUpperCase())

export const normalizeTradeUom = (code: string): string => code.trim().toUpperCase()
