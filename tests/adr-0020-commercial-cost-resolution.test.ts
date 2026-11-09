import { describe, expect, it } from "vitest"
import {
  resolveCommercialPrice,
  reconcileActualMargin,
  type CommercialPricingContext,
  type CommercialCostEvidence,
  type CommercialMarginPolicy,
} from "../src/baobab/pricing/commercial-cost-resolution"

const now = "2026-11-09T12:00:00Z"
const context: CommercialPricingContext = {
  tenantId: "tenant-zb",
  sellerLegalEntityId: "zb-za",
  marketId: "ZA",
  productId: "coffee-variant",
  buyerOrganisationId: "buyer-a",
  currencyCode: "ZAR",
}
const cost: CommercialCostEvidence = {
  tenantId: context.tenantId,
  sellerLegalEntityId: context.sellerLegalEntityId,
  marketId: context.marketId,
  productId: context.productId,
  currencyCode: "ZAR",
  costBasisType: "ESTIMATED_LANDED",
  amountMinor: "10000",
  sourceSystem: "GOVERNED_ESTIMATE",
  sourceReference: "estimate-v1",
  version: "v1",
  observedAt: "2026-11-09T10:00:00Z",
  validUntil: "2026-11-10T12:00:00Z",
}
const policy: CommercialMarginPolicy = {
  tenantId: context.tenantId,
  sellerLegalEntityId: context.sellerLegalEntityId,
  marketId: context.marketId,
  productId: context.productId,
  policyReference: "policy-zb-za",
  version: "v3",
  method: "GROSS_MARGIN",
  targetBasisPoints: 2500,
  minimumBasisPoints: 1000,
  belowMinimum: "BLOCK",
  validFrom: "2026-11-08T00:00:00Z",
  validUntil: "2026-12-01T00:00:00Z",
}
const decide = (
  c: CommercialPricingContext = context,
  costEvidence: CommercialCostEvidence = cost,
  marginPolicy: CommercialMarginPolicy = policy,
  offer?: string,
) => resolveCommercialPrice(c, costEvidence, marginPolicy, now, offer)

describe("ADR-0020 commercial cost/price authority seam", () => {
  it("distinguishes exact 25% gross margin from 25% markup", () => {
    expect(decide().snapshot.targetPriceMinor).toBe("13334")
    expect(decide(context, cost, { ...policy, method: "MARKUP" }).snapshot.targetPriceMinor).toBe(
      "12500",
    )
  })

  it("rounds gross margin up in exact minor units and reproducibly fingerprints snapshots", () => {
    const first = decide()
    expect(first.snapshot.floorPriceMinor).toBe("11112")
    expect(first.snapshot.expectedMarginMinor).toBe("3334")
    expect(first).toEqual(decide())
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(decide(context, { ...cost, version: "v2" }).fingerprint).not.toBe(first.fingerprint)
  })

  it("rejects cross-tenant, cross-seller, cross-Market and cross-product evidence", () => {
    for (const field of ["tenantId", "sellerLegalEntityId", "marketId", "productId"] as const) {
      expect(() => decide(context, { ...cost, [field]: "foreign" })).toThrow("scope mismatch")
      expect(() => decide(context, cost, { ...policy, [field]: "foreign" })).toThrow("scope mismatch")
    }
  })

  it("refuses a different buyer's policy without inheriting their commercial terms", () => {
    expect(() =>
      decide(context, cost, { ...policy, buyerOrganisationId: "buyer-b" }),
    ).toThrow("another buyer")
  })

  it("requires an explicit matching currency, never guesses FX conversion", () => {
    expect(() => decide({ ...context, currencyCode: "USD" })).toThrow("currency mismatch")
    expect(() => decide(context, { ...cost, currencyCode: "USD" })).toThrow("currency mismatch")
    expect(() => decide({ ...context, currencyCode: "zar" })).toThrow("currency mismatch")
  })

  it("rejects missing provenance, fabricated accounting cost, and invalid source", () => {
    expect(() => decide(context, { ...cost, sourceReference: "" })).toThrow("provenance")
    expect(() => decide(context, cost, { ...policy, version: "" })).toThrow("provenance")
    expect(() =>
      decide(context, { ...cost, costBasisType: "ACTUAL_LANDED" }),
    ).toThrow("ERP")
    expect(() =>
      decide(context, { ...cost, costBasisType: "WEIGHTED_AVERAGE" }),
    ).toThrow("ERP")
    expect(() =>
      decide(context, { ...cost, sourceSystem: "UNKNOWN" as "ERP" }),
    ).toThrow("source")
  })

  it("refuses stale, future-dated, and malformed cost and policy windows", () => {
    expect(() => decide(context, { ...cost, validUntil: now })).toThrow("stale")
    expect(() => decide(context, { ...cost, observedAt: "2026-11-10T00:00:00Z" })).toThrow(
      "future-dated",
    )
    expect(() => decide(context, cost, { ...policy, validFrom: now.replace("12:", "13:") })).toThrow(
      "not effective",
    )
    expect(() => decide(context, cost, { ...policy, validUntil: now })).toThrow("not effective")
    expect(() => decide(context, { ...cost, validUntil: "2026-02-30T00:00:00Z" })).toThrow(
      "real UTC",
    )
  })

  it("refuses binary-float, negative, exponential, and overprecision money", () => {
    for (const bad of ["100.01", "-100", "1e3", "01", "9999999999999999999999999"]) {
      expect(() => decide(context, { ...cost, amountMinor: bad })).toThrow(/money|precision/)
    }
    expect(() => decide(context, { ...cost, amountMinor: "0" })).toThrow("zero-cost")
  })

  it("does not silently waive a hard margin floor for contract or volume prices", () => {
    expect(() => decide(context, cost, policy, "10000")).toThrow("hard minimum")
    expect(decide(context, cost, policy, "12000").snapshot.state).toBe("ELIGIBLE")
  })

  it("returns approval-required without asserting a valid approval or order commitment", () => {
    const result = decide(context, cost, { ...policy, belowMinimum: "REQUIRE_APPROVAL" }, "10500")
    expect(result.snapshot.state).toBe("REQUIRES_APPROVAL")
    expect(result.snapshot.quotedPriceMinor).toBe("10500")
    expect(result.snapshot.floorPriceMinor).toBe("11112")
  })

  it("refuses ambiguous margin and invalid target/floor policy", () => {
    expect(() => decide(context, cost, { ...policy, method: "UNSPECIFIED" as "MARKUP" })).toThrow(
      "unrecognised",
    )
    expect(() => decide(context, cost, { ...policy, targetBasisPoints: 10000 })).toThrow(
      "below 100 percent",
    )
    expect(() => decide(context, cost, { ...policy, minimumBasisPoints: 3000 })).toThrow(
      "target is below",
    )
    expect(() => decide(context, cost, { ...policy, minimumBasisPoints: 1.5 })).toThrow(
      "integral",
    )
  })

  it("reconciles realised margin from ERP actual cost without rewriting quote facts", () => {
    const issued = decide().snapshot
    const actual: CommercialCostEvidence = {
      ...cost,
      sourceSystem: "ERP",
      costBasisType: "ACTUAL_LANDED",
      amountMinor: "11500",
      sourceReference: "erp-po-441",
      version: "v2",
    }
    const before = structuredClone(issued)
    expect(reconcileActualMargin(issued, actual)).toEqual({
      realisedMarginMinor: "1834",
      varianceFromExpectedMinor: "-1500",
      actualCostReference: "erp-po-441",
    })
    expect(issued).toEqual(before)
    expect(() => reconcileActualMargin(issued, { ...actual, tenantId: "other" })).toThrow(
      "scope mismatch",
    )
    expect(() =>
      reconcileActualMargin(issued, { ...actual, sourceSystem: "GOVERNED_ESTIMATE" }),
    ).toThrow("ERP actual")
  })
})
