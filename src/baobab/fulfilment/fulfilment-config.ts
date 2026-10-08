export type FulfilmentMode =
  | "LOCAL_DELIVERY"
  | "PARCEL_SHIPMENT"
  | "BULK_FREIGHT"
  | "CROSS_BORDER"
  | "CUSTOMER_COLLECTION"

export type FulfilmentProviderBinding = {
  key: string
  kind: "MEDUSA_NATIVE" | "ERP_ADAPTER" | "THIRD_PARTY"
  enabled: boolean
  modes: readonly FulfilmentMode[]
}

export type MarketFulfilmentPolicy = {
  marketKey: string
  countryCode: "UG" | "ZA"
  legalSellerKey: string
  providers: readonly FulfilmentProviderBinding[]
}

export const ZURIBEANS_FULFILMENT_POLICIES: readonly MarketFulfilmentPolicy[] = [
  {
    marketKey: "zuribeans_ug",
    countryCode: "UG",
    legalSellerKey: "zuribeans-uganda",
    providers: [
      {
        key: "manual-manual-ug",
        kind: "MEDUSA_NATIVE",
        enabled: true,
        modes: ["LOCAL_DELIVERY", "BULK_FREIGHT", "CUSTOMER_COLLECTION"],
      },
      {
        key: "idempiere-logistics-ug",
        kind: "ERP_ADAPTER",
        enabled: true,
        modes: ["CROSS_BORDER"],
      },
    ],
  },
  {
    marketKey: "zuribeans_za",
    countryCode: "ZA",
    legalSellerKey: "zuribeans-south-africa",
    providers: [
      {
        key: "manual-manual-za",
        kind: "MEDUSA_NATIVE",
        enabled: true,
        modes: ["LOCAL_DELIVERY", "BULK_FREIGHT", "CUSTOMER_COLLECTION"],
      },
      {
        key: "idempiere-logistics-za",
        kind: "ERP_ADAPTER",
        enabled: true,
        modes: ["CROSS_BORDER"],
      },
    ],
  },
] as const

export const resolveFulfilmentProvider = (policy: MarketFulfilmentPolicy, mode: FulfilmentMode) => {
  const provider = policy.providers.find(
    (candidate) => candidate.enabled && candidate.modes.includes(mode),
  )
  if (!provider) throw new Error("No enabled fulfilment provider supports this Market and mode")
  return provider
}
