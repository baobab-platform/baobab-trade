import type { MarketFulfilmentPolicy } from "../../fulfilment"

export const THAMANI_FULFILMENT_POLICIES: readonly MarketFulfilmentPolicy[] = [
  {
    marketKey: "thamani_ug",
    countryCode: "UG",
    legalSellerKey: "thamani-uganda",
    providers: [
      {
        key: "manual-thamani-ug",
        kind: "MEDUSA_NATIVE",
        enabled: true,
        modes: ["LOCAL_DELIVERY", "PARCEL_SHIPMENT", "CUSTOMER_COLLECTION"],
      },
      {
        key: "ug-courier-adapter",
        kind: "THIRD_PARTY",
        enabled: false,
        modes: ["LOCAL_DELIVERY", "PARCEL_SHIPMENT"],
      },
    ],
  },
  {
    marketKey: "thamani_za",
    countryCode: "ZA",
    legalSellerKey: "thamani-south-africa",
    providers: [
      {
        key: "manual-thamani-za",
        kind: "MEDUSA_NATIVE",
        enabled: true,
        modes: ["LOCAL_DELIVERY", "PARCEL_SHIPMENT", "CUSTOMER_COLLECTION"],
      },
      {
        key: "za-courier-adapter",
        kind: "THIRD_PARTY",
        enabled: false,
        modes: ["LOCAL_DELIVERY", "PARCEL_SHIPMENT"],
      },
    ],
  },
] as const
