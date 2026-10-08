import { describe, expect, it } from "vitest"
import {
  THAMANI_CATALOGUE,
  THAMANI_CATEGORY_COUNTS,
} from "../src/baobab/thamani/catalogue/catalogue-config"
import { THAMANI_SUPPLIERS, getThamaniSupplierConfig } from "../src/baobab/thamani/suppliers"

describe("Thamani B2C retail catalogue", () => {
  it("contains 38 products matching the governed category composition", () => {
    expect(THAMANI_CATALOGUE).toHaveLength(38)
    const total = Object.values(THAMANI_CATEGORY_COUNTS).reduce((sum, count) => sum + count, 0)
    expect(total).toBe(38)
    for (const [category, expectedCount] of Object.entries(THAMANI_CATEGORY_COUNTS)) {
      const actual = THAMANI_CATALOGUE.filter((product) => product.category === category).length
      expect(actual).toBe(expectedCount)
    }
  })

  it("uses unique canonical keys, handles, and SKUs", () => {
    for (const field of ["canonicalKey", "handle", "sku"] as const) {
      const values = THAMANI_CATALOGUE.map((product) => product[field])
      expect(new Set(values).size).toBe(THAMANI_CATALOGUE.length)
    }
  })

  it("references only known suppliers, spanning multiple independent suppliers", () => {
    for (const product of THAMANI_CATALOGUE) {
      expect(() => getThamaniSupplierConfig(product.supplierKey)).not.toThrow()
    }
    const distinctSuppliers = new Set(THAMANI_CATALOGUE.map((product) => product.supplierKey))
    expect(distinctSuppliers.size).toBeGreaterThanOrEqual(10)
  })

  it("does not hardcode a single default supplier (no coffee-supplier invariant)", () => {
    const coffeeAndTea = THAMANI_CATALOGUE.filter((product) => product.category === "COFFEE_TEA")
    const coffeeSuppliers = new Set(coffeeAndTea.map((product) => product.supplierKey))
    expect(coffeeSuppliers.size).toBeGreaterThan(1)
  })

  it("sources at least one product from ZuriBeans without making it the default", () => {
    const zuribeansSourced = THAMANI_CATALOGUE.filter(
      (product) => product.supplierKey === "sup_zuribeans_external",
    )
    expect(zuribeansSourced.length).toBeGreaterThanOrEqual(1)
    expect(zuribeansSourced.length).toBeLessThan(THAMANI_CATALOGUE.length)
  })

  it("prices UGX and ZAR independently as flat retail amounts with no volume tiers", () => {
    for (const product of THAMANI_CATALOGUE) {
      expect(product.prices.map((price) => price.currencyCode)).toEqual(["ugx", "zar"])
      for (const price of product.prices) {
        expect(Number.isInteger(price.standardAmount)).toBe(true)
        expect(price.standardAmount).toBeGreaterThan(0)
      }
    }
  })

  it("carries structured origin, classification, and packaging data", () => {
    for (const product of THAMANI_CATALOGUE) {
      expect(product.hsClassificationReference).toMatch(/^HS-/)
      expect(product.countryOfOrigin).toMatch(/^[A-Z]{2}$/)
      expect(product.netWeightKg).toBeGreaterThan(0)
      expect(product.grossWeightKg).toBeGreaterThanOrEqual(product.netWeightKg)
    }
  })

  it("gives every product at least one eligible Market, and most both", () => {
    for (const product of THAMANI_CATALOGUE) {
      expect(product.eligibleMarkets.length).toBeGreaterThan(0)
    }
    const singleMarketOnly = THAMANI_CATALOGUE.filter(
      (product) => product.eligibleMarkets.length === 1,
    )
    expect(singleMarketOnly.length).toBeGreaterThanOrEqual(2)
  })

  it("keeps a Uganda-only and a South Africa-only SKU for catalogue isolation tests", () => {
    const ugOnly = THAMANI_CATALOGUE.find((product) => product.sku === "TH-LIF-001")
    const zaOnly = THAMANI_CATALOGUE.find((product) => product.sku === "TH-LIF-002")
    expect(ugOnly?.eligibleMarkets).toEqual(["thamani_ug"])
    expect(zaOnly?.eligibleMarkets).toEqual(["thamani_za"])
  })

  it("keeps Thamani vanilla extract a distinct product identity from ZuriBeans whole vanilla pods", () => {
    const vanilla = THAMANI_CATALOGUE.find((product) => product.sku === "TH-SPI-003")
    expect(vanilla?.title).toContain("Extract")
    expect(vanilla?.canonicalKey).not.toBe("ug-specialty-vanilla")
  })
})

describe("Thamani synthetic supplier network", () => {
  it("has 15-20 suppliers, all explicitly synthetic", () => {
    expect(THAMANI_SUPPLIERS.length).toBeGreaterThanOrEqual(15)
    expect(THAMANI_SUPPLIERS.length).toBeLessThanOrEqual(20)
    for (const supplier of THAMANI_SUPPLIERS) {
      expect(supplier.synthetic).toBe(true)
      expect(supplier.note.length).toBeGreaterThan(0)
    }
  })

  it("uses unique supplier keys", () => {
    expect(new Set(THAMANI_SUPPLIERS.map((s) => s.supplierKey)).size).toBe(THAMANI_SUPPLIERS.length)
  })

  it("rejects an unknown supplier key", () => {
    expect(() => getThamaniSupplierConfig("sup_unknown")).toThrow("Unknown Thamani supplier key")
  })

  it("represents ZuriBeans as one optional supplier category, not a default", () => {
    const zuribeans = getThamaniSupplierConfig("sup_zuribeans_external")
    expect(zuribeans.category).toBe("EXTERNAL_B2B_SUPPLIER")
  })
})
