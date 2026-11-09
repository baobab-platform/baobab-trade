import { describe, expect, it } from "vitest"
import { selectPrice, type PriceCandidate } from "../src/baobab/pricing/decision-port"

const request = {
  variantId: "variant-aa",
  marketKey: "zuribeans_za",
  organisationId: "org-a",
  currencyCode: "zar",
  quantity: 20,
}
const base: PriceCandidate = {
  kind: "STANDARD_WHOLESALE",
  amount: 615000,
  currencyCode: "zar",
  variantId: "variant-aa",
  marketKey: "zuribeans_za",
  status: "ACTIVE",
}

describe("ADR-0012 scoped B2B pricing and money", () => {
  it("refuses a foreign Market or variant before pricing precedence", () => {
    expect(() =>
      selectPrice(request, [
        {
          ...base,
          marketKey: "zuribeans_ug",
          kind: "CONTRACT",
          amount: 1,
          organisationId: "org-a",
        },
        base,
      ]),
    ).not.toThrow()
    expect(
      selectPrice(request, [
        {
          ...base,
          marketKey: "zuribeans_ug",
          kind: "CONTRACT",
          amount: 1,
          organisationId: "org-a",
        },
        base,
      ]).amount,
    ).toBe(615000)
    expect(() => selectPrice(request, [{ ...base, variantId: "variant-other" }])).toThrow(
      "No authorised price",
    )
  })
  it("never treats an unbound CONTRACT or private price from another buyer as public", () => {
    expect(
      selectPrice(request, [
        base,
        { ...base, kind: "CUSTOMER_SPECIFIC", amount: 1 },
        { ...base, kind: "CONTRACT", amount: 1, organisationId: "org-b" },
      ]).amount,
    ).toBe(615000)
  })
  it("rejects ambiguous same-precedence quantity tiers independently of returned ordering", () => {
    const a = { ...base, kind: "VOLUME" as const, amount: 480000, minQuantity: 10, maxQuantity: 30 }
    const b = { ...base, kind: "VOLUME" as const, amount: 490000, minQuantity: 15, maxQuantity: 40 }
    for (const rows of [
      [a, b],
      [b, a],
    ]) {
      expect(() => selectPrice(request, [base, ...rows])).toThrow("Ambiguous price precedence")
    }
  })
  it("never resolves future/expired/inactive private agreements", () => {
    const privatePrice: PriceCandidate = {
      ...base,
      kind: "CONTRACT",
      amount: 400000,
      organisationId: "org-a",
    }
    const now = Date.parse("2026-11-09T10:00:00Z")
    for (const override of [
      { effectiveFrom: "2026-11-10T00:00:00Z" },
      { effectiveUntil: "2026-11-08T00:00:00Z" },
      { effectiveFrom: "invalid" },
      { effectiveFrom: "2026-11-12T00:00:00Z", effectiveUntil: "2026-11-11T00:00:00Z" },
      { status: "SUSPENDED" as const },
    ]) {
      expect(selectPrice(request, [base, { ...privatePrice, ...override }], now).amount).toBe(
        615000,
      )
    }
  })
  it("retains the exact active contract boundary with an exclusive end", () => {
    const p: PriceCandidate = {
      ...base,
      kind: "CONTRACT",
      organisationId: "org-a",
      amount: 450000,
      effectiveFrom: "2026-11-09T00:00:00Z",
      effectiveUntil: "2026-11-10T00:00:00Z",
    }
    expect(selectPrice(request, [base, p], Date.parse("2026-11-09T00:00:00Z")).amount).toBe(450000)
    expect(selectPrice(request, [base, p], Date.parse("2026-11-10T00:00:00Z")).amount).toBe(615000)
  })
  it("rejects floating, NaN, negative and unsafe minor-unit amounts", () => {
    for (const amount of [
      1.25,
      Number.NaN,
      -1,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => selectPrice(request, [{ ...base, amount }])).toThrow("safe integer minor units")
    }
  })
  it("rejects invalid quantity tiers and zero multiples", () => {
    expect(() => selectPrice(request, [{ ...base, minQuantity: -1 }])).toThrow(
      "invalid quantity tier",
    )
    expect(() => selectPrice(request, [{ ...base, minQuantity: 21, maxQuantity: 20 }])).toThrow(
      "invalid quantity tier",
    )
  })
})
