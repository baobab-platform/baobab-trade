/**
 * Thamani's synthetic supplier network (spec §23-24). Thamani is a B2C
 * retailer with many suppliers behind its retail boundary — it is not a
 * marketplace, so a Supplier here is procurement/provenance metadata only:
 * it never becomes a Medusa seller account, storefront, or settlement
 * counterparty. Supplier authority belongs to ERP/procurement (iDempiere);
 * this list is Trade's local, engine-native breadcrumb of who a
 * `ProductRetailProfile` came from, pending that integration.
 *
 * Every entry below is explicitly synthetic development/reference data. The
 * one exception in spirit is `sup_zuribeans_external`, which represents a
 * real sibling Digital Estate (ZuriBeans B2B) as one possible supplier among
 * many — spec §6/§16: "ZuriBeans MAY be one of Thamani's suppliers. It SHALL
 * NOT be assumed to be Thamani's default supplier." No live procurement
 * integration with ZuriBeans exists yet, so it is still flagged synthetic
 * here: only the *identity* of the relationship is real, not the data.
 */
export type SupplierCategory =
  | "FOOD_MANUFACTURER"
  | "COFFEE_ROASTER"
  | "FMCG_DISTRIBUTOR"
  | "PERSONAL_CARE_MANUFACTURER"
  | "HOUSEHOLD_GOODS_SUPPLIER"
  | "REGIONAL_WHOLESALER"
  | "IMPORTER"
  | "LOCAL_SME"
  | "AGRICULTURAL_SUPPLIER"
  | "EXTERNAL_B2B_SUPPLIER"

export type ThamaniSupplierConfig = {
  supplierKey: string
  name: string
  category: SupplierCategory
  originCountry: string
  synthetic: true
  note: string
}

export const THAMANI_SUPPLIERS: readonly ThamaniSupplierConfig[] = [
  {
    supplierKey: "sup_ug_mountain_roasters",
    name: "Mountain Peak Coffee Roasters",
    category: "COFFEE_ROASTER",
    originCountry: "UG",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_ug_savanna_foods",
    name: "Savanna Foods Manufacturing Ltd",
    category: "FOOD_MANUFACTURER",
    originCountry: "UG",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_za_cape_fmcg",
    name: "Cape FMCG Distributors",
    category: "FMCG_DISTRIBUTOR",
    originCountry: "ZA",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_za_karoo_naturals",
    name: "Karoo Naturals Manufacturing",
    category: "PERSONAL_CARE_MANUFACTURER",
    originCountry: "ZA",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_ug_nile_household",
    name: "Nile Household Goods Co",
    category: "HOUSEHOLD_GOODS_SUPPLIER",
    originCountry: "UG",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_ke_rift_wholesale",
    name: "Rift Valley Regional Wholesale",
    category: "REGIONAL_WHOLESALER",
    originCountry: "KE",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_import_subcontinent_grains",
    name: "Subcontinent Grain Importers",
    category: "IMPORTER",
    originCountry: "IN",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_import_indochina_provisions",
    name: "Indochina Provisions Trading",
    category: "IMPORTER",
    originCountry: "VN",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_ug_kampala_sme",
    name: "Kampala Artisan Foods",
    category: "LOCAL_SME",
    originCountry: "UG",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_za_joburg_sme",
    name: "Johannesburg Home Crafts",
    category: "LOCAL_SME",
    originCountry: "ZA",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_ug_elgon_agri",
    name: "Mount Elgon Agricultural Cooperative",
    category: "AGRICULTURAL_SUPPLIER",
    originCountry: "UG",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_za_winelands_agri",
    name: "Winelands Agricultural Suppliers",
    category: "AGRICULTURAL_SUPPLIER",
    originCountry: "ZA",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_import_south_america_cocoa",
    name: "South America Cocoa Importers",
    category: "IMPORTER",
    originCountry: "BR",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_import_europe_fmcg",
    name: "European FMCG Import Partners",
    category: "IMPORTER",
    originCountry: "NL",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_za_durban_household",
    name: "Durban Household Manufacturing",
    category: "HOUSEHOLD_GOODS_SUPPLIER",
    originCountry: "ZA",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_ug_entebbe_personal_care",
    name: "Entebbe Personal Care Manufacturing",
    category: "PERSONAL_CARE_MANUFACTURER",
    originCountry: "UG",
    synthetic: true,
    note: "Synthetic development supplier; not a real business.",
  },
  {
    supplierKey: "sup_zuribeans_external",
    name: "ZuriBeans (external B2B supplier)",
    category: "EXTERNAL_B2B_SUPPLIER",
    originCountry: "UG",
    synthetic: true,
    note: "Represents the real sibling ZuriBeans B2B estate as one optional Thamani supplier; no live procurement integration exists yet, so the relationship data itself remains illustrative.",
  },
]

export const getThamaniSupplierConfig = (supplierKey: string): ThamaniSupplierConfig => {
  const config = THAMANI_SUPPLIERS.find((supplier) => supplier.supplierKey === supplierKey)
  if (!config) {
    throw new Error(`Unknown Thamani supplier key "${supplierKey}"`)
  }
  return config
}
