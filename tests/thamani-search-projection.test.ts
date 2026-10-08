import { describe, expect, it } from "vitest"
import {
  deriveActiveEligibleMarketKeys,
  isThamaniProduct,
  toThamaniSearchDocument,
  type ThamaniProductQueryResult,
} from "../src/baobab/thamani/search/projection"

const thamaniProduct: ThamaniProductQueryResult = {
  id: "prod_1",
  title: "Uganda Arabica Ground Coffee 250g",
  handle: "thamani-uganda-arabica-ground-coffee-250g",
  description: "Roasted Arabica coffee.",
  status: "published",
  metadata: {
    baobab_catalogue: "thamani_b2c",
    thamani_category: "COFFEE_TEA",
    thamani_brand: "Thamani Kitchen",
    thamani_country_of_origin: "UG",
    thamani_supplier_key: "sup_zuribeans_external",
    thamani_consumer_uom: "BAG",
    thamani_eligible_markets: ["thamani_ug", "thamani_za"],
  },
  variants: [
    {
      sku: "TH-COF-001",
      prices: [
        { currency_code: "ugx", amount: 18_000 },
        { currency_code: "zar", amount: 145 },
      ],
    },
  ],
}

describe("isThamaniProduct", () => {
  it("recognises a Thamani-catalogued product", () => {
    expect(isThamaniProduct(thamaniProduct.metadata)).toBe(true)
  })

  it("rejects a ZuriBeans B2B product on the same engine instance", () => {
    expect(isThamaniProduct({ baobab_catalogue: "zuribeans_b2b" })).toBe(false)
  })

  it("rejects a product with no Baobab catalogue tag at all", () => {
    expect(isThamaniProduct(null)).toBe(false)
    expect(isThamaniProduct(undefined)).toBe(false)
    expect(isThamaniProduct({})).toBe(false)
  })
})

describe("toThamaniSearchDocument", () => {
  it("projects catalogue metadata and per-currency prices onto the search document", () => {
    const document = toThamaniSearchDocument(thamaniProduct)
    expect(document).toEqual({
      id: "prod_1",
      title: "Uganda Arabica Ground Coffee 250g",
      handle: "thamani-uganda-arabica-ground-coffee-250g",
      description: "Roasted Arabica coffee.",
      status: "published",
      thamani_category: "COFFEE_TEA",
      brand: "Thamani Kitchen",
      country_of_origin: "UG",
      supplier_key: "sup_zuribeans_external",
      consumer_uom: "BAG",
      eligible_market_keys: ["thamani_ug", "thamani_za"],
      sku: "TH-COF-001",
      price_ugx: 18_000,
      price_zar: 145,
    })
  })

  it("preserves a single-Market product's narrower eligibility list", () => {
    const ugOnly: ThamaniProductQueryResult = {
      ...thamaniProduct,
      metadata: { ...thamaniProduct.metadata, thamani_eligible_markets: ["thamani_ug"] },
    }
    expect(toThamaniSearchDocument(ugOnly).eligible_market_keys).toEqual(["thamani_ug"])
  })

  it("degrades gracefully when metadata, variants, or a currency price are missing", () => {
    const bare: ThamaniProductQueryResult = {
      id: "prod_2",
      title: "Bare Product",
      handle: "bare-product",
      description: null,
      status: "draft",
      metadata: null,
      variants: [],
    }
    expect(toThamaniSearchDocument(bare)).toEqual({
      id: "prod_2",
      title: "Bare Product",
      handle: "bare-product",
      description: "",
      status: "draft",
      thamani_category: null,
      brand: null,
      country_of_origin: null,
      supplier_key: null,
      consumer_uom: null,
      eligible_market_keys: [],
      sku: null,
      price_ugx: null,
      price_zar: null,
    })
  })

  it("does not fabricate a price for a currency the variant does not carry", () => {
    const zarOnly: ThamaniProductQueryResult = {
      ...thamaniProduct,
      variants: [{ sku: "TH-LIF-002", prices: [{ currency_code: "zar", amount: 180 }] }],
    }
    const document = toThamaniSearchDocument(zarOnly)
    expect(document.price_zar).toBe(180)
    expect(document.price_ugx).toBeNull()
  })
})

describe("deriveActiveEligibleMarketKeys", () => {
  it("keeps only ACTIVE eligibility records", () => {
    expect(
      deriveActiveEligibleMarketKeys([
        { market_key: "thamani_ug", status: "ACTIVE" },
        { market_key: "thamani_za", status: "ACTIVE" },
      ]),
    ).toEqual(["thamani_ug", "thamani_za"])
  })

  it("excludes a SUSPENDED or WITHDRAWN record — this is the Market isolation fix", () => {
    expect(
      deriveActiveEligibleMarketKeys([
        { market_key: "thamani_ug", status: "ACTIVE" },
        { market_key: "thamani_za", status: "SUSPENDED" },
      ]),
    ).toEqual(["thamani_ug"])

    expect(
      deriveActiveEligibleMarketKeys([{ market_key: "thamani_ug", status: "WITHDRAWN" }]),
    ).toEqual([])
  })

  it("returns an empty list for no eligibility records at all", () => {
    expect(deriveActiveEligibleMarketKeys([])).toEqual([])
  })
})
