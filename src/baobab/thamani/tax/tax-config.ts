import type { MarketTaxContext } from "../../tax"

export const THAMANI_TAX_CONTEXTS: readonly MarketTaxContext[] = [
  {
    marketKey: "thamani_ug",
    jurisdictionKey: "UG",
    currency: "UGX",
    legalSellerKey: "thamani-uganda",
    providerKey: "baobab_reference",
    sellerRegistrationReference: "control-plane:thamani-uganda:ug-tax-registration",
    pricesIncludeTax: true,
    failClosed: true,
  },
  {
    marketKey: "thamani_za",
    jurisdictionKey: "ZA",
    currency: "ZAR",
    legalSellerKey: "thamani-south-africa",
    providerKey: "baobab_reference",
    sellerRegistrationReference: "control-plane:thamani-south-africa:za-tax-registration",
    pricesIncludeTax: true,
    failClosed: true,
  },
] as const

export const resolveThamaniTaxContext = (marketKey: string, legalSellerKey: string) => {
  const context = THAMANI_TAX_CONTEXTS.find(
    (candidate) => candidate.marketKey === marketKey && candidate.legalSellerKey === legalSellerKey,
  )
  if (!context) throw new Error("No authoritative Thamani tax context for Market and Legal Seller")
  return context
}
