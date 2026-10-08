import { describe, expect, it } from "vitest"
import {
  THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
  ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
} from "../src/baobab/context/digital-estates"
import {
  EffectiveDatedTaxProviderAdapter,
  selectEffectiveRule,
  type EffectiveTaxRule,
  type TaxDeterminationRequest,
} from "../src/baobab/tax"
const rule = (
  version: string,
  from: string,
  until?: string,
  digitalEstate: string = ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
): EffectiveTaxRule => ({
  digitalEstate,
  ruleReference: "test-rule",
  ruleVersion: version,
  jurisdictionKey: "UG",
  productTaxClassification: "TEST",
  transactionType: "GOODS",
  treatment: "STANDARD",
  rateBasisPoints: version === "v1" ? 1000 : 1200,
  effectiveFrom: new Date(from),
  effectiveUntil: until ? new Date(until) : undefined,
  sourceAuthority: "TEST_ONLY",
  sourceRetrievedAt: new Date("2026-01-01"),
})
const rules = [rule("v1", "2026-01-01", "2027-01-01"), rule("v2", "2027-01-01")]
const request: TaxDeterminationRequest = {
  determinationReference: "det-1",
  marketKey: "zuribeans_ug",
  legalSellerKey: "seller-ug",
  sellerRegistrationReference: "reg-1",
  organisationId: "org-1",
  jurisdictionKey: "UG",
  shipFromCountry: "UG",
  shipToCountry: "UG",
  billToCountry: "UG",
  productTaxClassification: "TEST",
  transactionType: "GOODS",
  currency: "UGX",
  taxableBasisMinor: 101,
  priceDisplayMode: "TAX_EXCLUSIVE",
  effectiveAt: new Date("2026-06-01"),
  idempotencyKey: "idem-1",
  correlationId: "corr-1",
}
describe("effective-dated tax provider", () => {
  it("preserves historical rules and activates future rules only on time", () => {
    expect(
      selectEffectiveRule(rules, new Date("2026-12-31"), ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID)
        .ruleVersion,
    ).toBe("v1")
    expect(
      selectEffectiveRule(rules, new Date("2027-01-01"), ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID)
        .ruleVersion,
    ).toBe("v2")
  })
  it("never matches a rule belonging to the other Digital Estate, even with identical jurisdiction/classification/transaction-type/effective-dating", () => {
    const thamaniRule = rule("v1", "2026-01-01", "2027-01-01", THAMANI_DIGITAL_ESTATE_CANONICAL_ID)
    expect(() =>
      selectEffectiveRule(
        [thamaniRule],
        new Date("2026-06-01"),
        ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
      ),
    ).toThrow("No effective tax rule")
  })
  it("rounds deterministically and retains provenance", async () => {
    const result = await new EffectiveDatedTaxProviderAdapter({
      providerKey: "test-provider",
      async listRules() {
        return rules
      },
    }).determine(request)
    expect(result.taxAmountMinor).toBe(10)
    expect(result.ruleVersion).toBe("v1")
    expect(result.sourceAuthority).toBe("TEST_ONLY")
  })
  it("determine() derives the Digital Estate from the request's tax subject and ignores a same-jurisdiction rule from the other estate", async () => {
    const thamaniRule = rule("v9", "2026-01-01", undefined, THAMANI_DIGITAL_ESTATE_CANONICAL_ID)
    await expect(
      new EffectiveDatedTaxProviderAdapter({
        providerKey: "test-provider",
        async listRules() {
          // A ZuriBeans (organisationId-bearing) request must never be satisfied by a
          // Thamani-only rule set, even though jurisdiction/classification/type all match.
          return [thamaniRule]
        },
      }).determine(request),
    ).rejects.toThrow("No effective tax rule")
  })
  it("distinguishes protected zero treatments and requires reasons", async () => {
    const invalid = { ...rules[0], treatment: "EXEMPT" as const, rateBasisPoints: 0 }
    await expect(
      new EffectiveDatedTaxProviderAdapter({
        providerKey: "test",
        async listRules() {
          return [invalid]
        },
      }).determine(request),
    ).rejects.toThrow(/legal reason/)
  })
})
