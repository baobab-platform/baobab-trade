export type InventoryLocationConfig = {
  code: string
  name: string
  marketKey: "zuribeans_ug" | "zuribeans_za"
  countryCode: "UG" | "ZA"
  city: string
  addressLine: string
  erpWarehouseReference: string
  initialProjectedPacks: number
  reusesMarketPrimary: boolean
}

export const ZURIBEANS_INVENTORY_LOCATIONS: readonly InventoryLocationConfig[] = [
  {
    code: "UG-KLA-01",
    name: "Kampala Central Warehouse",
    marketKey: "zuribeans_ug",
    countryCode: "UG",
    city: "Kampala",
    addressLine: "Synthetic Gate 7 warehouse address",
    erpWarehouseReference: "IDEMPIERE:UG-KLA-01",
    initialProjectedPacks: 120,
    reusesMarketPrimary: true,
  },
  {
    code: "UG-EBB-01",
    name: "Entebbe Export Staging",
    marketKey: "zuribeans_ug",
    countryCode: "UG",
    city: "Entebbe",
    addressLine: "Synthetic Gate 7 export-staging address",
    erpWarehouseReference: "IDEMPIERE:UG-EBB-01",
    initialProjectedPacks: 30,
    reusesMarketPrimary: false,
  },
  {
    code: "UG-JIN-01",
    name: "Jinja Collection Facility",
    marketKey: "zuribeans_ug",
    countryCode: "UG",
    city: "Jinja",
    addressLine: "Synthetic Gate 7 collection-facility address",
    erpWarehouseReference: "IDEMPIERE:UG-JIN-01",
    initialProjectedPacks: 50,
    reusesMarketPrimary: false,
  },
  {
    code: "ZA-CPT-01",
    name: "Cape Town Distribution Warehouse",
    marketKey: "zuribeans_za",
    countryCode: "ZA",
    city: "Cape Town",
    addressLine: "Synthetic Gate 7 distribution address",
    erpWarehouseReference: "IDEMPIERE:ZA-CPT-01",
    initialProjectedPacks: 20,
    reusesMarketPrimary: false,
  },
  {
    code: "ZA-JNB-01",
    name: "Johannesburg Distribution Centre",
    marketKey: "zuribeans_za",
    countryCode: "ZA",
    city: "Johannesburg",
    addressLine: "Synthetic Gate 7 distribution address",
    erpWarehouseReference: "IDEMPIERE:ZA-JNB-01",
    initialProjectedPacks: 40,
    reusesMarketPrimary: true,
  },
  {
    code: "ZA-DUR-01",
    name: "Durban Import Staging",
    marketKey: "zuribeans_za",
    countryCode: "ZA",
    city: "Durban",
    addressLine: "Synthetic Gate 7 import-staging address",
    erpWarehouseReference: "IDEMPIERE:ZA-DUR-01",
    initialProjectedPacks: 15,
    reusesMarketPrimary: false,
  },
] as const

export const inventoryLocationMetadata = (location: InventoryLocationConfig) => ({
  baobab_market_key: location.marketKey,
  baobab_canonical_location_key: location.code,
  baobab_erp_warehouse_reference: location.erpWarehouseReference,
  baobab_inventory_projection: "synthetic-gate-7-v1",
})
