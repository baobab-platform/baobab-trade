import { describe, expect, it } from "vitest"
import { ZURIBEANS_CATALOGUE } from "../src/baobab/catalogue"

describe("ZuriBeans B2B catalogue", () => {
  it("contains the ten approved product families including both vanilla grades", () => {
    expect(ZURIBEANS_CATALOGUE).toHaveLength(10)
    expect(
      ZURIBEANS_CATALOGUE.filter((product) => product.attributes.kind === "VANILLA"),
    ).toHaveLength(2)
  })

  it("uses unique canonical keys, handles, and SKUs", () => {
    for (const field of ["canonicalKey", "handle", "sku"] as const) {
      expect(new Set(ZURIBEANS_CATALOGUE.map((product) => product[field])).size).toBe(10)
    }
  })

  it("carries structured origin, classification, packaging, and traceability data", () => {
    for (const product of ZURIBEANS_CATALOGUE) {
      expect(product.hsClassificationReference).toMatch(/^HS-/)
      expect(product.exportEligibilityReference).toMatch(/^policy:/)
      expect(product.netWeightKg).toBeGreaterThan(0)
      expect(product.grossWeightKg).toBeGreaterThanOrEqual(product.netWeightKg)
      expect(product.lotControlled).toBe(true)
      expect(product.batchControlled).toBe(true)
    }
  })

  it("prices UGX and ZAR independently with two non-overlapping volume tiers", () => {
    for (const product of ZURIBEANS_CATALOGUE) {
      expect(product.prices.map((price) => price.currencyCode)).toEqual(["ugx", "zar"])
      for (const price of product.prices) {
        expect(Number.isInteger(price.standardAmount)).toBe(true)
        expect(price.volumeTiers).toEqual([
          expect.objectContaining({ minQuantity: 5, maxQuantity: 19 }),
          expect.objectContaining({ minQuantity: 20 }),
        ])
        expect(price.volumeTiers[0].amount).toBeLessThan(price.standardAmount)
        expect(price.volumeTiers[1].amount).toBeLessThan(price.volumeTiers[0].amount)
      }
    }
  })

  it("defines explicit Market eligibility and positive MOQ/order multiples", () => {
    for (const product of ZURIBEANS_CATALOGUE) {
      expect(product.eligibleMarkets).toEqual(["zuribeans_ug", "zuribeans_za"])
      expect(product.minimumOrderQuantity).toBeGreaterThan(0)
      expect(product.orderMultiple).toBeGreaterThan(0)
    }
  })
})
