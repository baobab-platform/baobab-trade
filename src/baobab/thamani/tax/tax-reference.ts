import { THAMANI_DIGITAL_ESTATE_CANONICAL_ID } from "../../context/digital-estates"
import type { EffectiveTaxRule } from "../../tax"

export const THAMANI_TAX_SOURCE_RETRIEVED_AT = new Date("2026-09-09T00:00:00Z")

export const THAMANI_STANDARD_TAX_RULES: readonly EffectiveTaxRule[] = [
  {
    digitalEstate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
    ruleReference: "thamani:ug:vat:standard",
    ruleVersion: "2026-09-09",
    jurisdictionKey: "UG",
    productTaxClassification: "STANDARD",
    transactionType: "GOODS",
    treatment: "STANDARD",
    rateBasisPoints: 1800,
    effectiveFrom: new Date("2026-09-09T00:00:00Z"),
    sourceAuthority: "https://thetaxman.ura.go.ug/?p=1175",
    sourceRetrievedAt: THAMANI_TAX_SOURCE_RETRIEVED_AT,
  },
  {
    digitalEstate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
    ruleReference: "thamani:za:vat:standard",
    ruleVersion: "2026-09-09",
    jurisdictionKey: "ZA",
    productTaxClassification: "STANDARD",
    transactionType: "GOODS",
    treatment: "STANDARD",
    rateBasisPoints: 1500,
    effectiveFrom: new Date("2026-09-09T00:00:00Z"),
    sourceAuthority: "https://www.sars.gov.za/types-of-tax/value-added-tax/",
    sourceRetrievedAt: THAMANI_TAX_SOURCE_RETRIEVED_AT,
  },
] as const

export const THAMANI_TAX_CATEGORIES = ["STANDARD", "ZERO_RATED", "EXEMPT"] as const

export const categoryVerificationStatus = (category: (typeof THAMANI_TAX_CATEGORIES)[number]) =>
  category === "STANDARD" ? ("VERIFIED" as const) : ("REVIEW_REQUIRED" as const)
