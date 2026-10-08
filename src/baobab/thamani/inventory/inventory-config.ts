import type { ThamaniMarketKey, ThamaniProductConfig } from "../catalogue"

export type ThamaniInventoryLocationConfig = {
  canonicalKey: string
  marketKey: ThamaniMarketKey
  countryCode: "UG" | "ZA"
  city: string
  name: string
  addressLine: string
  erpWarehouseReference: string
  reusesMarketPrimary: boolean
  initialQuantity: number
}

export const THAMANI_INVENTORY_LOCATIONS: readonly ThamaniInventoryLocationConfig[] = [
  {
    canonicalKey: "TH-UG-KLA-01",
    marketKey: "thamani_ug",
    countryCode: "UG",
    city: "Kampala",
    name: "Kampala Central Warehouse",
    addressLine: "Synthetic Thamani Gate 10 warehouse address",
    erpWarehouseReference: "IDEMPIERE:TH-UG-KLA-01",
    reusesMarketPrimary: true,
    initialQuantity: 80,
  },
  {
    canonicalKey: "TH-UG-EBB-01",
    marketKey: "thamani_ug",
    countryCode: "UG",
    city: "Entebbe",
    name: "Entebbe Import Staging",
    addressLine: "Synthetic Thamani Gate 10 import-staging address",
    erpWarehouseReference: "IDEMPIERE:TH-UG-EBB-01",
    reusesMarketPrimary: false,
    initialQuantity: 20,
  },
  {
    canonicalKey: "TH-ZA-CPT-01",
    marketKey: "thamani_za",
    countryCode: "ZA",
    city: "Cape Town",
    name: "Cape Town Distribution Warehouse",
    addressLine: "Synthetic Thamani Gate 10 distribution address",
    erpWarehouseReference: "IDEMPIERE:TH-ZA-CPT-01",
    reusesMarketPrimary: true,
    initialQuantity: 60,
  },
  {
    canonicalKey: "TH-ZA-JNB-01",
    marketKey: "thamani_za",
    countryCode: "ZA",
    city: "Johannesburg",
    name: "Johannesburg Distribution Centre",
    addressLine: "Synthetic Thamani Gate 10 distribution address",
    erpWarehouseReference: "IDEMPIERE:TH-ZA-JNB-01",
    reusesMarketPrimary: false,
    initialQuantity: 45,
  },
  {
    canonicalKey: "TH-ZA-DUR-01",
    marketKey: "thamani_za",
    countryCode: "ZA",
    city: "Durban",
    name: "Durban Import Staging",
    addressLine: "Synthetic Thamani Gate 10 import-staging address",
    erpWarehouseReference: "IDEMPIERE:TH-ZA-DUR-01",
    reusesMarketPrimary: false,
    initialQuantity: 20,
  },
] as const

export const thamaniInventoryLocationMetadata = (location: ThamaniInventoryLocationConfig) => ({
  baobab_digital_estate: "thamani_b2c",
  baobab_market_key: location.marketKey,
  baobab_canonical_location_key: location.canonicalKey,
  baobab_erp_warehouse_reference: location.erpWarehouseReference,
  baobab_inventory_projection: "synthetic-thamani-gate-10-v1",
})

export const locationsForProduct = (product: Pick<ThamaniProductConfig, "eligibleMarkets">) =>
  THAMANI_INVENTORY_LOCATIONS.filter((location) =>
    product.eligibleMarkets.includes(location.marketKey),
  )
