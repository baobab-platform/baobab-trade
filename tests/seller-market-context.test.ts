import { describe, expect, it } from "vitest"
import { assertCurrentSellerMarketContext } from "../src/baobab/orders/seller-market-context"

const now = Date.parse("2026-10-10T03:00:00Z")
const context = {
  context_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c",
  tenant_id: "tn_example",
  organisation_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6d",
  organisation_type: "ORGANISATION",
  country_code: "ZA",
  currency_code: "ZAR",
  resolved_at: new Date(now - 1000).toISOString(),
  expires_at: new Date(now + 5000).toISOString(),
}
const expected = {
  tenantId: context.tenant_id,
  organisationId: context.organisation_id,
  marketCode: "ZA",
  currencyCode: "ZAR",
}
describe("LA-05C4 canonical market and currency attestation", () => {
  it("accepts a current exact CP context", () => {
    expect(() => assertCurrentSellerMarketContext(context, expected, now)).not.toThrow()
  })
  it("denies tenant-wide CP context without an explicit market or currency", () => {
    expect(() =>
      assertCurrentSellerMarketContext({ ...context, country_code: undefined }, expected, now),
    ).toThrow("missing or conflicting")
    expect(() =>
      assertCurrentSellerMarketContext({ ...context, currency_code: undefined }, expected, now),
    ).toThrow("missing or conflicting")
  })
  it("denies cross-tenant, organisation, market, currency and stale/future contexts", () => {
    for (const overrides of [
      { tenant_id: "tn_other" },
      { organisation_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6e" },
      { country_code: "UG" },
      { currency_code: "UGX" },
      { resolved_at: new Date(now - 31_000).toISOString() },
      { resolved_at: new Date(now + 3000).toISOString() },
      { expires_at: new Date(now).toISOString() },
    ]) {
      expect(() =>
        assertCurrentSellerMarketContext({ ...context, ...overrides }, expected, now),
      ).toThrow("LA-05C4 denied")
    }
  })
})
