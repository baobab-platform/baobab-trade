export type CommodityAttributes =
  | {
      kind: "COFFEE"
      species: "ARABICA" | "ROBUSTA"
      grade: string
      processingMethod: string
      originRegion: string
    }
  | {
      kind: "VANILLA"
      grade: string
      podForm: "WHOLE_CURED"
      moistureRange: string
      minimumPodLengthCm?: number
      curingMethod: string
    }
  | { kind: "COCOA" | "TEA" | "GINGER"; grade: string; form: string }

export type MarketPrice = {
  currencyCode: "ugx" | "zar"
  standardAmount: number
  volumeTiers: readonly { minQuantity: number; maxQuantity?: number; amount: number }[]
}

export type ZuriBeansProductConfig = {
  canonicalKey: string
  title: string
  handle: string
  sku: string
  hsClassificationReference: string
  commodityCategory: string
  tradeUom: "BAG" | "CARTON"
  netWeightKg: number
  grossWeightKg: number
  packaging: string
  lotControlled: boolean
  batchControlled: boolean
  exportEligibilityReference: string
  attributes: CommodityAttributes
  eligibleMarkets: readonly ("zuribeans_ug" | "zuribeans_za")[]
  minimumOrderQuantity: number
  orderMultiple: number
  prices: readonly MarketPrice[]
}

const prices = (
  ugx: [number, number, number],
  zar: [number, number, number],
): readonly MarketPrice[] => [
  {
    currencyCode: "ugx",
    standardAmount: ugx[0],
    volumeTiers: [
      { minQuantity: 5, maxQuantity: 19, amount: ugx[1] },
      { minQuantity: 20, amount: ugx[2] },
    ],
  },
  {
    currencyCode: "zar",
    standardAmount: zar[0],
    volumeTiers: [
      { minQuantity: 5, maxQuantity: 19, amount: zar[1] },
      { minQuantity: 20, amount: zar[2] },
    ],
  },
]

export const ZURIBEANS_CATALOGUE: readonly ZuriBeansProductConfig[] = [
  {
    canonicalKey: "ug-arabica-green-aa",
    title: "Uganda Arabica Green Coffee AA",
    handle: "uganda-arabica-green-coffee-aa",
    sku: "ZB-UG-COF-ARA-AA-60",
    hsClassificationReference: "HS-0901.11",
    commodityCategory: "GREEN_COFFEE",
    tradeUom: "BAG",
    netWeightKg: 60,
    grossWeightKg: 60.3,
    packaging: "Jute bag with food-grade liner",
    lotControlled: true,
    batchControlled: true,
    exportEligibilityReference: "policy:ug-coffee-export",
    attributes: {
      kind: "COFFEE",
      species: "ARABICA",
      grade: "AA",
      processingMethod: "WASHED",
      originRegion: "Rwenzori and Mount Elgon",
    },
    eligibleMarkets: ["zuribeans_ug", "zuribeans_za"],
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    prices: prices([1_280_000, 1_240_000, 1_190_000], [6_150, 5_950, 5_700]),
  },
  {
    canonicalKey: "ug-specialty-arabica",
    title: "Uganda Specialty Arabica",
    handle: "uganda-specialty-arabica",
    sku: "ZB-UG-COF-ARA-SP-60",
    hsClassificationReference: "HS-0901.11",
    commodityCategory: "SPECIALTY_GREEN_COFFEE",
    tradeUom: "BAG",
    netWeightKg: 60,
    grossWeightKg: 60.3,
    packaging: "Jute bag with GrainPro liner",
    lotControlled: true,
    batchControlled: true,
    exportEligibilityReference: "policy:ug-coffee-export",
    attributes: {
      kind: "COFFEE",
      species: "ARABICA",
      grade: "SPECIALTY_84_PLUS",
      processingMethod: "WASHED",
      originRegion: "Mount Elgon",
    },
    eligibleMarkets: ["zuribeans_ug", "zuribeans_za"],
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    prices: prices([1_560_000, 1_510_000, 1_450_000], [7_500, 7_250, 6_950]),
  },
  {
    canonicalKey: "ug-robusta-screen-18",
    title: "Uganda Robusta Screen 18",
    handle: "uganda-robusta-screen-18",
    sku: "ZB-UG-COF-ROB-S18-60",
    hsClassificationReference: "HS-0901.11",
    commodityCategory: "GREEN_COFFEE",
    tradeUom: "BAG",
    netWeightKg: 60,
    grossWeightKg: 60.3,
    packaging: "Jute bag with food-grade liner",
    lotControlled: true,
    batchControlled: true,
    exportEligibilityReference: "policy:ug-coffee-export",
    attributes: {
      kind: "COFFEE",
      species: "ROBUSTA",
      grade: "SCREEN_18",
      processingMethod: "NATURAL",
      originRegion: "Central Uganda",
    },
    eligibleMarkets: ["zuribeans_ug", "zuribeans_za"],
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    prices: prices([1_020_000, 990_000, 950_000], [4_900, 4_750, 4_550]),
  },
  {
    canonicalKey: "ug-robusta-faq",
    title: "Uganda Robusta FAQ",
    handle: "uganda-robusta-faq",
    sku: "ZB-UG-COF-ROB-FAQ-60",
    hsClassificationReference: "HS-0901.11",
    commodityCategory: "GREEN_COFFEE",
    tradeUom: "BAG",
    netWeightKg: 60,
    grossWeightKg: 60.3,
    packaging: "Jute bag",
    lotControlled: true,
    batchControlled: true,
    exportEligibilityReference: "policy:ug-coffee-export",
    attributes: {
      kind: "COFFEE",
      species: "ROBUSTA",
      grade: "FAQ",
      processingMethod: "NATURAL",
      originRegion: "Central Uganda",
    },
    eligibleMarkets: ["zuribeans_ug", "zuribeans_za"],
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    prices: prices([900_000, 875_000, 840_000], [4_350, 4_200, 4_000]),
  },
  {
    canonicalKey: "ug-arabica-microlot",
    title: "Uganda Arabica Microlot",
    handle: "uganda-arabica-microlot",
    sku: "ZB-UG-COF-ARA-ML-30",
    hsClassificationReference: "HS-0901.11",
    commodityCategory: "SPECIALTY_GREEN_COFFEE",
    tradeUom: "BAG",
    netWeightKg: 30,
    grossWeightKg: 30.2,
    packaging: "Vacuum or GrainPro-lined carton",
    lotControlled: true,
    batchControlled: true,
    exportEligibilityReference: "policy:ug-coffee-export",
    attributes: {
      kind: "COFFEE",
      species: "ARABICA",
      grade: "MICROLOT_86_PLUS",
      processingMethod: "LOT_SPECIFIC",
      originRegion: "Uganda single-origin lot",
    },
    eligibleMarkets: ["zuribeans_ug", "zuribeans_za"],
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    prices: prices([1_050_000, 1_020_000, 980_000], [5_050, 4_900, 4_700]),
  },
  {
    canonicalKey: "ug-vanilla-grade-a",
    title: "Uganda Bourbon Vanilla Pods Grade A",
    handle: "uganda-bourbon-vanilla-pods-grade-a",
    sku: "ZB-UG-VAN-BRB-A-05",
    hsClassificationReference: "HS-0905.10",
    commodityCategory: "VANILLA",
    tradeUom: "CARTON",
    netWeightKg: 5,
    grossWeightKg: 5.4,
    packaging: "Vacuum-packed food-grade bags in export carton",
    lotControlled: true,
    batchControlled: true,
    exportEligibilityReference: "policy:ug-vanilla-export",
    attributes: {
      kind: "VANILLA",
      grade: "GRADE_A_GOURMET",
      podForm: "WHOLE_CURED",
      moistureRange: "30-35%",
      minimumPodLengthCm: 16,
      curingMethod: "TRADITIONAL_SUN_CURED",
    },
    eligibleMarkets: ["zuribeans_ug", "zuribeans_za"],
    minimumOrderQuantity: 2,
    orderMultiple: 2,
    prices: prices([2_100_000, 2_035_000, 1_950_000], [10_100, 9_800, 9_350]),
  },
  {
    canonicalKey: "ug-vanilla-extraction",
    title: "Uganda Vanilla Pods Extraction Grade",
    handle: "uganda-vanilla-pods-extraction-grade",
    sku: "ZB-UG-VAN-EXT-05",
    hsClassificationReference: "HS-0905.10",
    commodityCategory: "VANILLA",
    tradeUom: "CARTON",
    netWeightKg: 5,
    grossWeightKg: 5.4,
    packaging: "Vacuum-packed food-grade bags in export carton",
    lotControlled: true,
    batchControlled: true,
    exportEligibilityReference: "policy:ug-vanilla-export",
    attributes: {
      kind: "VANILLA",
      grade: "EXTRACTION",
      podForm: "WHOLE_CURED",
      moistureRange: "20-28%",
      curingMethod: "TRADITIONAL_SUN_CURED",
    },
    eligibleMarkets: ["zuribeans_ug", "zuribeans_za"],
    minimumOrderQuantity: 2,
    orderMultiple: 2,
    prices: prices([1_350_000, 1_310_000, 1_255_000], [6_500, 6_300, 6_050]),
  },
  {
    canonicalKey: "ug-cocoa-beans",
    title: "Uganda Cocoa Beans",
    handle: "uganda-cocoa-beans",
    sku: "ZB-UG-COC-BEAN-60",
    hsClassificationReference: "HS-1801.00",
    commodityCategory: "COCOA",
    tradeUom: "BAG",
    netWeightKg: 60,
    grossWeightKg: 60.3,
    packaging: "Jute bag with food-grade liner",
    lotControlled: true,
    batchControlled: true,
    exportEligibilityReference: "policy:ug-cocoa-export",
    attributes: { kind: "COCOA", grade: "EXPORT_GRADE", form: "FERMENTED_DRY_BEANS" },
    eligibleMarkets: ["zuribeans_ug", "zuribeans_za"],
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    prices: prices([1_620_000, 1_570_000, 1_505_000], [7_800, 7_550, 7_250]),
  },
  {
    canonicalKey: "ug-black-tea",
    title: "Uganda Black Tea",
    handle: "uganda-black-tea",
    sku: "ZB-UG-TEA-BLK-50",
    hsClassificationReference: "HS-0902.40",
    commodityCategory: "TEA",
    tradeUom: "BAG",
    netWeightKg: 50,
    grossWeightKg: 50.3,
    packaging: "Multiwall kraft sack with food-grade liner",
    lotControlled: true,
    batchControlled: true,
    exportEligibilityReference: "policy:ug-tea-export",
    attributes: { kind: "TEA", grade: "BP1_PF1_BLEND", form: "BLACK_CTC" },
    eligibleMarkets: ["zuribeans_ug", "zuribeans_za"],
    minimumOrderQuantity: 2,
    orderMultiple: 1,
    prices: prices([620_000, 600_000, 575_000], [3_000, 2_900, 2_780]),
  },
  {
    canonicalKey: "ug-dried-ginger",
    title: "Uganda Dried Ginger",
    handle: "uganda-dried-ginger",
    sku: "ZB-UG-GIN-DRY-25",
    hsClassificationReference: "HS-0910.11",
    commodityCategory: "SPICE",
    tradeUom: "BAG",
    netWeightKg: 25,
    grossWeightKg: 25.2,
    packaging: "Food-grade lined woven sack",
    lotControlled: true,
    batchControlled: true,
    exportEligibilityReference: "policy:ug-ginger-export",
    attributes: { kind: "GINGER", grade: "EXPORT_GRADE", form: "DRIED_SPLIT" },
    eligibleMarkets: ["zuribeans_ug", "zuribeans_za"],
    minimumOrderQuantity: 2,
    orderMultiple: 2,
    prices: prices([780_000, 755_000, 725_000], [3_750, 3_630, 3_480]),
  },
] as const

export const VOLUME_PRICE_LIST_KEY = "zuribeans_b2b_volume_v1"
