import { describe, expect, it } from "vitest"
import { ZURIBEANS_TAX_CONTEXTS, resolveTaxContext } from "../src/baobab/tax"
describe("ZuriBeans tax contexts", () => {
  it("keeps Market, jurisdiction, currency, and Legal Seller distinct", () => {
    expect(ZURIBEANS_TAX_CONTEXTS).toHaveLength(2)
    const [ug, za] = ZURIBEANS_TAX_CONTEXTS
    expect(ug.jurisdictionKey).toBe("UG")
    expect(za.jurisdictionKey).toBe("ZA")
    expect(ug.currency).toBe("UGX")
    expect(za.currency).toBe("ZAR")
    expect(ug.legalSellerKey).not.toBe(za.legalSellerKey)
  })
  it("fails closed for an invalid seller/Market combination", () => {
    expect(() => resolveTaxContext("zuribeans_ug", "zuribeans-south-africa")).toThrow(
      /authoritative/,
    )
  })
})
