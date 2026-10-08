export type MarketTaxContext = {
  marketKey: string
  jurisdictionKey: "UG" | "ZA"
  currency: "UGX" | "ZAR"
  legalSellerKey: string
  providerKey: "tp_system" | "baobab_reference" | "external_provider"
  sellerRegistrationReference: string
  pricesIncludeTax: boolean
  failClosed: true
}

export const ZURIBEANS_TAX_CONTEXTS: readonly MarketTaxContext[] = [
  {
    marketKey: "zuribeans_ug",
    jurisdictionKey: "UG",
    currency: "UGX",
    legalSellerKey: "zuribeans-uganda",
    providerKey: "tp_system",
    sellerRegistrationReference: "control-plane:zuribeans-uganda:ug-tax-registration",
    pricesIncludeTax: false,
    failClosed: true,
  },
  {
    marketKey: "zuribeans_za",
    jurisdictionKey: "ZA",
    currency: "ZAR",
    legalSellerKey: "zuribeans-south-africa",
    providerKey: "tp_system",
    sellerRegistrationReference: "control-plane:zuribeans-south-africa:za-tax-registration",
    pricesIncludeTax: false,
    failClosed: true,
  },
] as const

export const resolveTaxContext = (marketKey: string, legalSellerKey: string): MarketTaxContext => {
  const context = ZURIBEANS_TAX_CONTEXTS.find(
    (candidate) => candidate.marketKey === marketKey && candidate.legalSellerKey === legalSellerKey,
  )
  if (!context) throw new Error("No authoritative tax context for Market and Legal Seller")
  return context
}
