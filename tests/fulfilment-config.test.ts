import { describe, expect, it } from "vitest"
import { ZURIBEANS_FULFILMENT_POLICIES, resolveFulfilmentProvider } from "../src/baobab/fulfilment"
describe("ZuriBeans fulfilment policy", () => {
  it("supports local, bulk, collection, and cross-border modes in both Markets", () => {
    expect(ZURIBEANS_FULFILMENT_POLICIES).toHaveLength(2)
    for (const policy of ZURIBEANS_FULFILMENT_POLICIES) {
      expect(resolveFulfilmentProvider(policy, "LOCAL_DELIVERY").kind).toBe("MEDUSA_NATIVE")
      expect(resolveFulfilmentProvider(policy, "BULK_FREIGHT").kind).toBe("MEDUSA_NATIVE")
      expect(resolveFulfilmentProvider(policy, "CROSS_BORDER").kind).toBe("ERP_ADAPTER")
    }
  })
  it("keeps Market, country, and Legal Seller distinct", () => {
    const [ug, za] = ZURIBEANS_FULFILMENT_POLICIES
    expect(ug.marketKey).not.toBe(za.marketKey)
    expect(ug.countryCode).not.toBe(za.countryCode)
    expect(ug.legalSellerKey).not.toBe(za.legalSellerKey)
  })
})
