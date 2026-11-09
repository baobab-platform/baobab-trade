import { describe, expect, it } from "vitest"
import { selectPrice, type PriceCandidate, type PricingDecisionRequest } from "../src/baobab/pricing/decision-port"

const context: PricingDecisionRequest = {
  variantId: "variant_coffee",
  marketKey: "zuribeans_za",
  organisationId: "org_buyer_a",
  currencyCode: "zar",
  quantity: 20,
  legalSellerId: "seller_za",
  effectiveAt: "2026-11-09T12:00:00Z",
}
const base: PriceCandidate = {
  kind: "CONTRACT",
  amount: 12500,
  currencyCode: "zar",
  organisationId: "org_buyer_a",
  variantId: "variant_coffee",
  marketKey: "zuribeans_za",
  legalSellerId: "seller_za",
  effectiveFrom: "2026-11-01T00:00:00Z",
  effectiveUntil: "2026-12-01T00:00:00Z",
}

describe("ADR-0012 authoritative commercial pricing negative decisions", () => {
  it("selects the valid in-scope contract with explicit effective time", () => {
    expect(selectPrice(context, [base])).toMatchObject({ kind: "CONTRACT", amount: 12500 })
  })
  it.each([
    ["other Market", { marketKey: "zuribeans_ug" }],
    ["other buyer organisation", { organisationId: "org_buyer_b" }],
    ["other variant", { variantId: "variant_vanilla" }],
    ["other legal seller", { legalSellerId: "seller_ug" }],
    ["future-dated", { effectiveFrom: "2026-12-01T00:00:00Z", effectiveUntil: undefined }],
    ["expired", { effectiveUntil: "2026-11-09T12:00:00Z" }],
    ["wrong currency", { currencyCode: "usd" }],
    ["wrong quantity tier", { minQuantity: 21 }],
  ])("refuses %s private or inapplicable price", (_name, change) => {
    expect(() => selectPrice(context, [{ ...base, ...change }])).toThrow("No authorised price")
  })
  it("does not adopt a price intended for a different legal seller when seller context is missing", () => {
    expect(() => selectPrice({ ...context, legalSellerId: undefined }, [base])).toThrow(
      "No authorised price",
    )
  })
  it.each([
    ["fractional money", { amount: 1.5 }],
    ["negative money", { amount: -1 }],
    ["unsafe money", { amount: Number.MAX_SAFE_INTEGER + 1 }],
    ["NaN money", { amount: NaN }],
    ["invalid tier", { minQuantity: 10.5 }],
    ["reversed tier", { minQuantity: 50, maxQuantity: 10 }],
    ["malformed date", { effectiveFrom: "tomorrow" }],
    ["unqualified timezone", { effectiveFrom: "2026-11-09T00:00:00" }],
    ["reversed interval", { effectiveFrom: "2027-01-01T00:00:00Z" }],
  ])("refuses %s rather than selecting or falling back", (_name, change) => {
    expect(() => selectPrice(context, [{ ...base, ...change }])).toThrow("Invalid pricing candidate")
  })
  it("refuses ambiguous same-precedence contract terms regardless of input order", () => {
    const overlapping = { ...base, amount: 12000 }
    expect(() => selectPrice(context, [base, overlapping])).toThrow("Ambiguous")
    expect(() => selectPrice(context, [overlapping, base])).toThrow("Ambiguous")
  })
  it("refuses ambiguous overlapping quantity tiers", () => {
    const tiers: PriceCandidate[] = [
      { kind: "VOLUME", amount: 10000, currencyCode: "zar", minQuantity: 10 },
      { kind: "VOLUME", amount: 9500, currencyCode: "zar", minQuantity: 20 },
    ]
    expect(() => selectPrice(context, tiers)).toThrow("Ambiguous")
  })
  it("refuses a browser-controlled or invalid effective timestamp", () => {
    expect(() => selectPrice({ ...context, effectiveAt: "not-a-date" }, [base])).toThrow(
      "Invalid effective pricing instant",
    )
  })
  it("refuses an incomplete buyer context", () => {
    expect(() => selectPrice({ ...context, organisationId: "" }, [base])).toThrow(
      "Invalid pricing context",
    )
  })
})
