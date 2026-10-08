import { describe, expect, it } from "vitest"
import { toMedusaCurrencyCode } from "../src/baobab/market/market-config"
import { ZURIBEANS_LAUNCH_MARKETS } from "../src/baobab/market/market-config"
import {
  THAMANI_LAUNCH_MARKETS,
  THAMANI_SOUTH_AFRICA,
  THAMANI_UGANDA,
  getThamaniMarketBootstrapConfig,
} from "../src/baobab/market/thamani-market-config"

describe("Thamani B2C launch Market configuration", () => {
  it("keeps Uganda and South Africa on distinct currencies and countries", () => {
    expect(THAMANI_UGANDA.defaultCurrency).toBe("UGX")
    expect(THAMANI_SOUTH_AFRICA.defaultCurrency).toBe("ZAR")
    expect(THAMANI_UGANDA.countryCode).toBe("UG")
    expect(THAMANI_SOUTH_AFRICA.countryCode).toBe("ZA")
  })

  it("does not leak one Market's allowed currencies into the other", () => {
    expect(THAMANI_UGANDA.allowedCurrencies).not.toContain("ZAR")
    expect(THAMANI_SOUTH_AFRICA.allowedCurrencies).not.toContain("UGX")
  })

  it("uses one principal B2C Sales Channel distinct from ZuriBeans B2B", () => {
    expect(THAMANI_UGANDA.salesChannel.key).toBe("thamani_b2c")
    expect(THAMANI_SOUTH_AFRICA.salesChannel.key).toBe("thamani_b2c")
    for (const zuribeansMarket of ZURIBEANS_LAUNCH_MARKETS) {
      expect(zuribeansMarket.salesChannel.key).not.toBe("thamani_b2c")
    }
  })

  it("uses market keys, sales channel, and stock locations distinct from ZuriBeans", () => {
    const zuribeansKeys = new Set(ZURIBEANS_LAUNCH_MARKETS.map((m) => m.marketKey))
    const zuribeansLocationKeys = new Set(ZURIBEANS_LAUNCH_MARKETS.map((m) => m.stockLocation.key))
    for (const market of THAMANI_LAUNCH_MARKETS) {
      expect(zuribeansKeys.has(market.marketKey)).toBe(false)
      expect(zuribeansLocationKeys.has(market.stockLocation.key)).toBe(false)
    }
  })

  it("defines distinct domestic shipping and tax contexts without hardcoded rates", () => {
    expect(THAMANI_UGANDA.shipping.serviceZone.countryCode).toBe("UG")
    expect(THAMANI_SOUTH_AFRICA.shipping.serviceZone.countryCode).toBe("ZA")
    expect(THAMANI_UGANDA.shipping.fulfillmentSet.key).not.toBe(
      THAMANI_SOUTH_AFRICA.shipping.fulfillmentSet.key,
    )
    expect(THAMANI_UGANDA.tax).not.toHaveProperty("rate")
    expect(THAMANI_SOUTH_AFRICA.tax).not.toHaveProperty("rate")
  })

  it("gives every Market a distinct, positively priced shipping option", () => {
    expect(THAMANI_UGANDA.shipping.shippingOption.amount).toBeGreaterThan(0)
    expect(THAMANI_SOUTH_AFRICA.shipping.shippingOption.amount).toBeGreaterThan(0)
    expect(THAMANI_UGANDA.shipping.shippingOption.key).not.toBe(
      THAMANI_SOUTH_AFRICA.shipping.shippingOption.key,
    )
    const zuribeansShippingOptionKeys = new Set(
      ZURIBEANS_LAUNCH_MARKETS.map((m) => m.shipping.shippingOption.key),
    )
    const zuribeansShippingOptionNames = new Set(
      ZURIBEANS_LAUNCH_MARKETS.map((m) => m.shipping.shippingOption.name),
    )
    for (const market of THAMANI_LAUNCH_MARKETS) {
      expect(zuribeansShippingOptionKeys.has(market.shipping.shippingOption.key)).toBe(false)
      // Regression: provisioning.ts's idempotency check used to key off
      // `name` alone, so a name collision across estates (not just within
      // one estate's own two Markets) would have the same silent effect.
      expect(zuribeansShippingOptionNames.has(market.shipping.shippingOption.name)).toBe(false)
    }
  })

  it("does not hardcode a UUID as a market identity", () => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    for (const market of THAMANI_LAUNCH_MARKETS) {
      expect(uuidPattern.test(market.marketKey)).toBe(false)
    }
  })

  it("resolves a known market key and rejects an unknown one", () => {
    expect(getThamaniMarketBootstrapConfig("thamani_ug")).toBe(THAMANI_UGANDA)
    expect(() => getThamaniMarketBootstrapConfig("thamani_ke")).toThrow(
      "Unknown Thamani market bootstrap key",
    )
  })

  it("normalises ISO currency codes to Medusa's lowercase convention", () => {
    expect(toMedusaCurrencyCode(THAMANI_UGANDA.defaultCurrency)).toBe("ugx")
    expect(toMedusaCurrencyCode(THAMANI_SOUTH_AFRICA.defaultCurrency)).toBe("zar")
  })
})
