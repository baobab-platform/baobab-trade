import { describe, expect, it } from "vitest"
import {
  roundTaxMinorUnits,
  EffectiveDatedTaxProviderAdapter,
  type TaxDeterminationRequest,
  type ScopedEffectiveTaxRule,
} from "../src/baobab/tax/tax-provider-port"
import { reconcileTax } from "../src/baobab/tax/reconciliation"

const request: TaxDeterminationRequest = {
  determinationReference: "det-za-1",
  transactionReference: "order-za-1",
  tenantId: "tn_zaoperator",
  principalId: "principal_za_1",
  marketId: "mkt_01k9za7b2b",
  marketRevision: 1,
  marketKey: "zuribeans_za",
  legalSellerId: "les_za_1",
  legalSellerKey: "seller-za",
  sellerRegistrationReference: "registration-za",
  organisationId: "buyer-a",
  jurisdictionKey: "ZA",
  shipFromCountry: "ZA",
  shipToCountry: "ZA",
  billToCountry: "ZA",
  productTaxClassification: "GOODS_STD",
  transactionType: "GOODS",
  currency: "ZAR",
  taxableBasisMinor: 101,
  priceDisplayMode: "TAX_EXCLUSIVE",
  taxPoint: {
    type: "ORDER_COMMITMENT",
    occurredAt: new Date("2026-11-09T10:00:00Z"),
    sourceEventReference: "order-commit-1",
    jurisdictionKey: "ZA",
  },
  idempotencyKey: "tax-1",
  correlationId: "corr-1",
}
const rule: ScopedEffectiveTaxRule = {
  tenantId: "tn_zaoperator",
  marketId: "mkt_01k9za7b2b",
  marketKey: "zuribeans_za",
  legalSellerId: "les_za_1",
  legalSellerKey: "seller-za",
  sellerRegistrationReference: "registration-za",
  currency: "ZAR",
  ruleReference: "rule-za",
  ruleVersion: "v1",
  jurisdictionKey: "ZA",
  productTaxClassification: "GOODS_STD",
  transactionType: "GOODS",
  treatment: "STANDARD",
  rateBasisPoints: 1500,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  sourceAuthority: "tax-policy",
  sourceRetrievedAt: new Date("2026-11-01T00:00:00Z"),
}
const adapter = (r: ScopedEffectiveTaxRule) =>
  new EffectiveDatedTaxProviderAdapter({
    providerKey: "test-only",
    listRules: async () => [r],
  })

describe("ADR-0018 exact tax determination, context, TaxPoint and reconciliation", () => {
  it("rounds in exact minor units, matching nonnegative half-up contract boundaries", () => {
    expect(roundTaxMinorUnits(101, 1500, false)).toBe(15)
    expect(roundTaxMinorUnits(10, 5000, false)).toBe(5)
    expect(roundTaxMinorUnits(101, 1500, true)).toBe(13)
    expect(roundTaxMinorUnits(0, 1500, false)).toBe(0)
    expect(roundTaxMinorUnits(100, 100_001, false)).toBe(1000)
  })

  it("does not suffer binary floating-point multiplication errors at a very large taxable base", () => {
    const amount = Number.MAX_SAFE_INTEGER
    const rate = 1
    const expected = Number((BigInt(amount) * BigInt(rate) + 5000n) / 10000n)
    expect(roundTaxMinorUnits(amount, rate, false)).toBe(expected)
  })

  it("rejects invalid basis points, unsafe currency amounts and arithmetic overflow", () => {
    for (const rate of [-1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => roundTaxMinorUnits(100, rate, false)).toThrow("basis points")
    }
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      expect(() => roundTaxMinorUnits(value, 1500, false)).toThrow("minor-unit")
    }
    expect(() => roundTaxMinorUnits(Number.MAX_SAFE_INTEGER, 100000, false)).toThrow(
      "exceeds exact",
    )
  })

  it("enforces rule rate and provenance before issuing tax to commerce", async () => {
    for (const changes of [
      { rateBasisPoints: -10 },
      { rateBasisPoints: 1.25 },
      { sourceAuthority: "" },
      { ruleVersion: "" },
      { sourceRetrievedAt: new Date("invalid") },
      { effectiveUntil: new Date("2026-01-01T00:00:00Z") },
    ]) {
      await expect(adapter({ ...rule, ...changes }).determine(request)).rejects.toThrow()
    }
  })

  it("requires exact tenant, Market, Legal Seller, registration and currency rule scope", async () => {
    for (const changes of [
      { tenantId: "tn_other" },
      { marketId: "mkt_other" },
      { marketKey: "other_market" },
      { legalSellerId: "les_other" },
      { legalSellerKey: "seller-other" },
      { sellerRegistrationReference: "registration-other" },
      { currency: "UGX" },
    ]) {
      await expect(adapter({ ...rule, ...changes }).determine(request)).rejects.toThrow(
        "No effective tax rule",
      )
    }
  })

  it("evaluates rule effective dating against the sourced TaxPoint, not wall-clock time", async () => {
    const expired = {
      ...rule,
      effectiveUntil: new Date("2026-11-01T00:00:00Z"),
    }
    await expect(adapter(expired).determine(request)).rejects.toThrow("No effective tax rule")
    const result = await adapter(rule).determine(request)
    expect(result.taxPoint.sourceEventReference).toBe("order-commit-1")
    expect(result.taxAmountMinor).toBe(15)
  })

  it("does not infer tax from currency when seller, registration or tax point is missing", async () => {
    for (const missing of [
      { legalSellerKey: "" },
      { legalSellerId: "" },
      { sellerRegistrationReference: "" },
      { jurisdictionKey: "" },
      { currency: "za" },
      { taxPoint: { ...request.taxPoint, occurredAt: new Date("invalid") } },
      { taxPoint: { ...request.taxPoint, sourceEventReference: "" } },
    ]) {
      await expect(adapter(rule).determine({ ...request, ...missing })).rejects.toThrow()
    }
  })

  it("does not allow a customer tax identifier to self-authorise a registration-dependent treatment", async () => {
    const restricted = { ...rule, treatment: "REVERSE_CHARGE" as const, legalReason: "statute:rc-1", requiresVerifiedCustomerRegistration: true }
    await expect(adapter(restricted).determine({
      ...request,
      customerTaxRegistrationReference: "taxreg-1",
      customerTaxRegistrationVerificationStatus: "UNVERIFIED",
    })).rejects.toThrow("requires verified customer tax registration")
    const verified = await adapter(restricted).determine({
      ...request,
      customerTaxRegistrationReference: "taxreg-1",
      customerTaxRegistrationJurisdictionKey: "ZA",
      customerTaxRegistrationVerificationStatus: "VERIFIED",
      customerTaxRegistrationVerifiedAt: new Date("2026-11-01T00:00:00Z"),
      customerTaxRegistrationVerificationSource: "verification-provider-1",
      customerTaxRegistrationValidFrom: new Date("2026-01-01T00:00:00Z"),
      customerTaxRegistrationValidUntil: new Date("2027-01-01T00:00:00Z"),
    })
    expect(verified.treatment).toBe("REVERSE_CHARGE")
  })

  it("retains distinct ZERO_RATED and EXEMPT with legally justified provenance", async () => {
    const zero = { ...rule, treatment: "ZERO_RATED" as const, legalReason: "evidence:export-1" }
    const exempt = { ...rule, treatment: "EXEMPT" as const, legalReason: "statute:exemption-1" }
    const z = await adapter(zero).determine(request)
    const e = await adapter(exempt).determine(request)
    expect(z.taxAmountMinor).toBe(0)
    expect(e.taxAmountMinor).toBe(0)
    expect(z.treatment).not.toBe(e.treatment)
    expect(z.legalReason).not.toBe(e.legalReason)
  })

  it("refuses non-exact ERP tax evidence instead of producing a NaN reconciliation delta", () => {
    for (const amount of [1.25, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        reconcileTax({
          commerceTaxMinor: 100,
          commerceCurrency: "ZAR",
          erpTaxMinor: amount,
          erpCurrency: "ZAR",
        }),
      ).toThrow("ERP tax amount")
    }
    expect(() =>
      reconcileTax({
        commerceTaxMinor: Infinity,
        commerceCurrency: "ZAR",
      }),
    ).toThrow("Commerce tax")
  })
})
