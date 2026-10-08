import { describe, expect, it } from "vitest"
import { EffectiveDatedTaxProviderAdapter, type EffectiveTaxRuleProvider } from "../src/baobab/tax"
import {
  THAMANI_STANDARD_TAX_RULES,
  THAMANI_TAX_CONTEXTS,
  categoryVerificationStatus,
} from "../src/baobab/thamani/tax"

const provider: EffectiveTaxRuleProvider = {
  providerKey: "baobab_reference",
  async listRules(request) {
    return THAMANI_STANDARD_TAX_RULES.filter(
      (rule) =>
        rule.jurisdictionKey === request.jurisdictionKey &&
        rule.productTaxClassification === request.productTaxClassification,
    )
  },
}

const request = (jurisdictionKey: "UG" | "ZA", amount: number) => {
  const context = THAMANI_TAX_CONTEXTS.find((item) => item.jurisdictionKey === jurisdictionKey)
  if (!context) throw new Error(`Missing ${jurisdictionKey} tax context`)
  return {
    determinationReference: `test-${jurisdictionKey}`,
    marketKey: context.marketKey,
    legalSellerKey: context.legalSellerKey,
    sellerRegistrationReference: context.sellerRegistrationReference,
    customerReference: "customer:test",
    jurisdictionKey,
    shipFromCountry: jurisdictionKey,
    shipToCountry: jurisdictionKey,
    billToCountry: jurisdictionKey,
    productTaxClassification: "STANDARD",
    transactionType: "GOODS" as const,
    currency: context.currency,
    taxableBasisMinor: amount,
    priceDisplayMode: "TAX_INCLUSIVE" as const,
    effectiveAt: new Date("2026-09-09T12:00:00Z"),
    idempotencyKey: `test-${jurisdictionKey}`,
    correlationId: "test",
  }
}

describe("Thamani Gate 13 tax", () => {
  it("keeps retail display tax-inclusive and fail-closed in each Market", () => {
    expect(THAMANI_TAX_CONTEXTS).toHaveLength(2)
    expect(THAMANI_TAX_CONTEXTS.every((item) => item.pricesIncludeTax && item.failClosed)).toBe(
      true,
    )
  })
  it.each([
    ["UG", 118_000, 18_000, 100_000],
    ["ZA", 11_500, 1_500, 10_000],
  ] as const)(
    "extracts %s VAT from an inclusive retail price",
    async (country, gross, tax, net) => {
      const result = await new EffectiveDatedTaxProviderAdapter(provider).determine(
        request(country, gross),
      )
      expect(result).toMatchObject({
        taxAmountMinor: tax,
        netAmountMinor: net,
        grossAmountMinor: gross,
      })
    },
  )
  it("rejects a B2B-shaped request even when jurisdiction and classification match a Thamani rule", async () => {
    await expect(
      new EffectiveDatedTaxProviderAdapter(provider).determine({
        ...request("UG", 118_000),
        customerReference: undefined,
        organisationId: "zuribeans-org",
      }),
    ).rejects.toThrow("No effective tax rule")
  })
  it("requires exactly one B2C or B2B tax subject", async () => {
    await expect(
      new EffectiveDatedTaxProviderAdapter(provider).determine({
        ...request("UG", 118_000),
        customerReference: undefined,
      }),
    ).rejects.toThrow("Exactly one")
  })
  it("does not activate protected categories without verified legal provenance", () => {
    expect(categoryVerificationStatus("STANDARD")).toBe("VERIFIED")
    expect(categoryVerificationStatus("ZERO_RATED")).toBe("REVIEW_REQUIRED")
    expect(categoryVerificationStatus("EXEMPT")).toBe("REVIEW_REQUIRED")
  })
})
