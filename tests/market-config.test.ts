import { describe, expect, it } from "vitest"
import {
  getMarketBootstrapConfig,
  toMedusaCurrencyCode,
  withAddedStoreCurrency,
  ZURIBEANS_LAUNCH_MARKETS,
  ZURIBEANS_SOUTH_AFRICA,
  ZURIBEANS_UGANDA,
} from "../src/baobab/market/market-config"

describe("ZuriBeans launch Market configuration", () => {
  it("keeps Uganda and South Africa on distinct currencies and countries", () => {
    expect(ZURIBEANS_UGANDA.defaultCurrency).toBe("UGX")
    expect(ZURIBEANS_SOUTH_AFRICA.defaultCurrency).toBe("ZAR")
    expect(ZURIBEANS_UGANDA.countryCode).toBe("UG")
    expect(ZURIBEANS_SOUTH_AFRICA.countryCode).toBe("ZA")
    expect(ZURIBEANS_UGANDA.defaultCurrency).not.toBe(ZURIBEANS_SOUTH_AFRICA.defaultCurrency)
  })

  it("does not leak one Market's allowed currencies into the other", () => {
    expect(ZURIBEANS_UGANDA.allowedCurrencies).not.toContain("ZAR")
    expect(ZURIBEANS_SOUTH_AFRICA.allowedCurrencies).not.toContain("UGX")
  })

  it("uses one principal B2B Sales Channel and distinct Market Stock Locations", () => {
    expect(ZURIBEANS_UGANDA.salesChannel.key).toBe("zuribeans_b2b")
    expect(ZURIBEANS_SOUTH_AFRICA.salesChannel.key).toBe("zuribeans_b2b")
    expect(ZURIBEANS_UGANDA.stockLocation.key).not.toBe(ZURIBEANS_SOUTH_AFRICA.stockLocation.key)
  })

  it("allows independent payment/shipping provider bindings per Market", () => {
    // Independently configurable today just means: distinct config objects,
    // not required to differ in value for the initial launch.
    expect(ZURIBEANS_UGANDA.payment).not.toBe(ZURIBEANS_SOUTH_AFRICA.payment)
    expect(ZURIBEANS_UGANDA.shipping).not.toBe(ZURIBEANS_SOUTH_AFRICA.shipping)
    expect(ZURIBEANS_UGANDA.payment.providerIds).toContain("pp_system_default")
    expect(ZURIBEANS_SOUTH_AFRICA.shipping.providerIds).toContain("manual_manual")
  })

  it("defines distinct domestic shipping and tax contexts without hardcoded rates", () => {
    expect(ZURIBEANS_UGANDA.shipping.serviceZone.countryCode).toBe("UG")
    expect(ZURIBEANS_SOUTH_AFRICA.shipping.serviceZone.countryCode).toBe("ZA")
    expect(ZURIBEANS_UGANDA.shipping.fulfillmentSet.key).not.toBe(
      ZURIBEANS_SOUTH_AFRICA.shipping.fulfillmentSet.key,
    )
    expect(ZURIBEANS_UGANDA.tax.automaticTaxes).toBe(true)
    expect(ZURIBEANS_SOUTH_AFRICA.tax.automaticTaxes).toBe(true)
    expect(ZURIBEANS_UGANDA.tax).not.toHaveProperty("rate")
  })

  it("gives every Market a distinct, positively priced shipping option", () => {
    // completeCartWorkflow cannot succeed without a real ShippingOption on
    // the service zone — see MarketBootstrapConfig.shipping.shippingOption's
    // doc comment for why this amount is a placeholder, not a sourced rate.
    expect(ZURIBEANS_UGANDA.shipping.shippingOption.amount).toBeGreaterThan(0)
    expect(ZURIBEANS_SOUTH_AFRICA.shipping.shippingOption.amount).toBeGreaterThan(0)
    expect(ZURIBEANS_UGANDA.shipping.shippingOption.key).not.toBe(
      ZURIBEANS_SOUTH_AFRICA.shipping.shippingOption.key,
    )
    // Regression: provisioning.ts's idempotency check used to key off `name`
    // alone. Every launch config used the same literal name, so only the
    // first Market provisioned ever got a real shipping option — the other
    // three silently matched that one Market's row on every later bootstrap
    // run and skipped creating their own.
    expect(ZURIBEANS_UGANDA.shipping.shippingOption.name).not.toBe(
      ZURIBEANS_SOUTH_AFRICA.shipping.shippingOption.name,
    )
  })

  it("does not hardcode a UUID as a market identity", () => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    for (const market of ZURIBEANS_LAUNCH_MARKETS) {
      expect(uuidPattern.test(market.marketKey)).toBe(false)
    }
  })

  it("resolves a known market key and rejects an unknown one", () => {
    expect(getMarketBootstrapConfig("zuribeans_ug")).toBe(ZURIBEANS_UGANDA)
    expect(() => getMarketBootstrapConfig("zuribeans_ke")).toThrow("Unknown market bootstrap key")
  })

  it("normalises ISO currency codes to Medusa's lowercase convention", () => {
    expect(toMedusaCurrencyCode("UGX")).toBe("ugx")
    expect(toMedusaCurrencyCode("ZAR")).toBe("zar")
  })
})

describe("withAddedStoreCurrency", () => {
  // Regression test: a live Medusa 2.20.1 run against a real store with no
  // currencies yet failed with "There should be a default currency set for
  // the store" because the first currency added was hardcoded to
  // is_default: false. A Store must always have exactly one default.
  it("makes the first currency added to an empty store the default", () => {
    expect(withAddedStoreCurrency([], "ugx")).toEqual([{ currency_code: "ugx", is_default: true }])
  })

  it("does not displace an existing default when adding a second currency", () => {
    const existing = [{ currency_code: "ugx", is_default: true }]
    expect(withAddedStoreCurrency(existing, "zar")).toEqual([
      { currency_code: "ugx", is_default: true },
      { currency_code: "zar", is_default: false },
    ])
  })

  it("preserves every existing currency rather than replacing the list", () => {
    const existing = [
      { currency_code: "ugx", is_default: true },
      { currency_code: "usd", is_default: false },
    ]
    const result = withAddedStoreCurrency(existing, "zar")
    expect(result).toHaveLength(3)
    expect(result.map((c) => c.currency_code)).toEqual(["ugx", "usd", "zar"])
  })
})
