import { describe, expect, it } from "vitest"
import type { BaobabMarket } from "../src/baobab/contracts/market"
import type { RawPlatformContextResolutionResponse } from "../src/baobab/contracts/platform-context"
import type { BaobabTenantContext } from "../src/baobab/contracts/tenant-context"
import { assertAuthorisedMarketExecution } from "../src/baobab/market/execution-authority"

const now = Date.parse("2026-11-09T10:00:00Z")
const tenant: BaobabTenantContext = {
  tenantId: "tn_zaoperator",
  entityId: "operator",
  lifecycleStatus: "active",
  productId: "baobab-trade",
  entitled: true,
  entitlementTier: null,
  cacheTtlSeconds: 15,
  resolvedAt: "2026-11-09T09:59:00Z",
  correlationId: "a465bf79-f962-4b27-9091-e614062acafd",
}
const market: BaobabMarket = {
  market_id: "mkt_za_b2b",
  canonical_key: "operator.za.b2b",
  name: "South African wholesale",
  owner_tenant_id: tenant.tenantId,
  legal_entity_id: "entity:seller-za",
  market_type: "B2B",
  status: "ACTIVE",
  default_country: "ZA",
  countries: ["ZA"],
  default_currency: "ZAR",
  allowed_currencies: ["ZAR", "USD"],
  effective_from: "2026-10-01T00:00:00Z",
  effective_to: "2026-12-31T00:00:00Z",
  revision: 3,
}
const stored: RawPlatformContextResolutionResponse = {
  context_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b",
  tenant_id: tenant.tenantId,
  market_id: market.market_id,
  currency_code: "ZAR",
  country_code: "ZA",
  resolved_at: "2026-11-09T09:59:00Z",
  expires_at: "2026-11-09T10:01:00Z",
}
const verify = (
  m: BaobabMarket = market,
  c: RawPlatformContextResolutionResponse = stored,
  t: BaobabTenantContext = tenant,
  id: string = market.market_id,
) => assertAuthorisedMarketExecution(t, m, c, id, now)

describe("ADR-0010 §105 CP Market transaction-scope conformance", () => {
  it("allows exact active CP Market, tenant, legal seller, currency and context", () => {
    expect(verify()).toEqual({
      marketId: "mkt_za_b2b",
      tenantId: "tn_zaoperator",
      contextId: stored.context_id,
      legalSellerCanonicalId: "entity:seller-za",
      transactionCurrency: "ZAR",
      countryCode: "ZA",
      marketRevision: 3,
    })
  })

  it("one tenant may serve two markets sharing a country/currency; neither can borrow the other's primary CP context", () => {
    const retail: BaobabMarket = {
      ...market,
      market_id: "mkt_za_retail",
      canonical_key: "operator.za.retail",
      market_type: "RETAIL",
    }
    expect(() => verify(retail, stored, tenant, retail.market_id)).toThrow(
      "did not authorise this exact Market",
    )
    expect(
      verify(retail, { ...stored, market_id: retail.market_id }, tenant, retail.market_id).marketId,
    ).toBe(retail.market_id)
  })

  it("refuses requested-market ID substitution even if the CP's stored primary market is valid", () => {
    expect(() => verify(market, stored, tenant, "mkt_another")).toThrow(
      "does not match the requested Market",
    )
  })

  it.each([
    ["foreign Market owner", { owner_tenant_id: "tn_other" }, {}],
    ["foreign stored Context", {}, { tenant_id: "tn_other" }],
    ["missing stored Market", {}, { market_id: undefined }],
    ["different stored Market", {}, { market_id: "mkt_other" }],
  ] as const)("rejects %s before exposing native projections", (_name, m, c) => {
    expect(() => verify({ ...market, ...m }, { ...stored, ...c })).toThrow()
  })

  it.each(["DRAFT", "VALIDATED", "DEPRECATED", "SUSPENDED", "MIGRATING", "RETIRED"] as const)(
    "refuses %s Market for new commerce",
    (status) => {
      expect(() => verify({ ...market, status })).toThrow("not ACTIVE")
    },
  )

  it("rejects future, expired, reversed and malformed Market effective windows", () => {
    for (const override of [
      { effective_from: "2026-11-10T00:00:00Z" },
      { effective_to: "2026-11-08T00:00:00Z" },
      { effective_from: "2026-12-01T00:00:00Z", effective_to: "2026-11-01T00:00:00Z" },
      { effective_from: "not-a-date" },
      { effective_from: "" },
      { effective_to: "invalid" },
    ]) {
      expect(() => verify({ ...market, ...override })).toThrow(/effective/)
    }
  })

  it("seller identity must be a canonical legal entity, not tenant or Medusa region inference", () => {
    for (const value of ["", "x", null, undefined]) {
      expect(() => verify({ ...market, legal_entity_id: value })).toThrow("canonical Legal Seller")
    }
  })

  it("requires CP transaction currency and Market allowed-currency policy to agree", () => {
    for (const override of [
      { currency_code: undefined },
      { currency_code: "USD" },
      { currency_code: "UGX" },
      { currency_code: "zar" },
    ]) {
      expect(() => verify(market, { ...stored, ...override })).toThrow("currency")
    }
    expect(() => verify({ ...market, default_currency: null })).toThrow("ISO 4217")
    expect(() => verify({ ...market, default_currency: "zar" })).toThrow("ISO 4217")
    expect(() => verify({ ...market, allowed_currencies: ["USD"] })).toThrow("currency")
    expect(() => verify({ ...market, allowed_currencies: [] })).toThrow("currency")
    // Shared schema permits the allowed list to be omitted: the default is then authoritative.
    expect(() => verify({ ...market, allowed_currencies: undefined })).not.toThrow()
  })

  it("one Market may cover several countries; country is not Market identity", () => {
    const multiCountry = { ...market, countries: ["ZA", "UG"] }
    const ugContext = { ...stored, country_code: "UG" }
    expect(verify(multiCountry, ugContext).countryCode).toBe("UG")
  })

  it("rejects a forged or non-participating country despite matching currency", () => {
    for (const countryCode of ["UG", undefined, "za", "KE"]) {
      expect(() => verify(market, { ...stored, country_code: countryCode })).toThrow(
        /participation country|outside its countries/,
      )
    }
  })

  it("rejects deactivated or non-entitled tenant Context", () => {
    expect(() => verify(market, stored, { ...tenant, lifecycleStatus: "suspended" })).toThrow(
      "Tenant context is not active",
    )
    expect(() => verify(market, stored, { ...tenant, entitled: false as true })).toThrow(
      "not entitled",
    )
  })

  it("does not consume expired or future CP authority", () => {
    for (const context of [
      { expires_at: "2026-11-09T10:00:00Z" },
      { expires_at: "2026-11-09T09:59:00Z" },
      { resolved_at: "2026-11-09T10:00:06Z" },
      { resolved_at: "not-a-time" },
      { expires_at: "not-a-time" },
    ]) {
      expect(() => verify(market, { ...stored, ...context })).toThrow()
    }
  })

  it("prevents zero or non-integral Market revisions from becoming commerce authority", () => {
    for (const revision of [0, -1, Number.NaN, 2.5]) {
      expect(() => verify({ ...market, revision })).toThrow("invalid revision")
    }
  })
})
