import { THAMANI_CATALOGUE, type ThamaniMarketKey } from "../catalogue"

export type ThamaniTradeProfile = {
  canonicalProductKey: string
  marketKey: ThamaniMarketKey
  originCountry: string
  hsClassificationReference: string
  hsClassificationStatus: "UNVERIFIED"
  customsTariffReference: string
  landedCostReference: string
  source: "THAMANI_CATALOGUE_REFERENCE_NOT_CUSTOMS_AUTHORITY"
}

export const THAMANI_TRADE_PROFILES: readonly ThamaniTradeProfile[] = THAMANI_CATALOGUE.flatMap(
  (product) =>
    product.eligibleMarkets.map((marketKey) => ({
      canonicalProductKey: product.canonicalKey,
      marketKey,
      originCountry: product.countryOfOrigin,
      hsClassificationReference: product.hsClassificationReference,
      hsClassificationStatus: "UNVERIFIED" as const,
      customsTariffReference: `customs-reference:${marketKey}:${product.sku}`,
      landedCostReference: `landed-cost:${marketKey}:${product.sku}`,
      source: "THAMANI_CATALOGUE_REFERENCE_NOT_CUSTOMS_AUTHORITY" as const,
    })),
)

export const requireVerifiedTradeProfile = (profile: {
  hsClassificationStatus: "VERIFIED" | "UNVERIFIED"
}): void => {
  if (profile.hsClassificationStatus !== "VERIFIED")
    throw new Error("Product HS classification requires customs review")
}
