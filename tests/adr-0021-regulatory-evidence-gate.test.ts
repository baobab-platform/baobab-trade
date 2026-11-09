import { describe, expect, it } from "vitest"
import {
  assertRegulatoryExecutionClearance,
  type RegulatoryContext,
  type RegulatoryEvidence,
  type RegulatoryCheck,
} from "../src/baobab/trade-readiness/regulatory-evidence-gate"

const now = "2026-11-09T12:00:00Z"
const context: RegulatoryContext = {
  tenantId: "tenant-zb",
  transactionReference: "trade-order-1",
  sellerLegalEntityId: "zb-ug",
  buyerOrganisationId: "buyer-a",
  originCountry: "UG",
  destinationCountry: "ZA",
  marketId: "ZA",
  productId: "coffee-1",
}
const checks: RegulatoryCheck[] = ["PRODUCT_CLASSIFICATION", "EXPORT_ELIGIBILITY", "IMPORT_ELIGIBILITY"]
const evidence = (check: RegulatoryCheck): RegulatoryEvidence => ({
  ...context,
  check,
  status: "PASS",
  providerId: "cp-qualified-regulator-1",
  bindingReference: "cp-binding-1",
  decisionReference: "decision-" + check,
  evidenceReference: "evidence-" + check,
  ruleVersion: "rules-2026",
  decidedAt: "2026-11-09T10:00:00Z",
  expiresAt: "2026-11-09T15:00:00Z",
})
const resolved = () => checks.map(evidence)

describe("ADR-0021 provider regulatory clearance", () => {
  it("requires distinct fresh PASS evidence for each mandatory control", () => {
    const result = assertRegulatoryExecutionClearance(context, checks, resolved(), now)
    expect(result.approvedChecks).toEqual(checks)
    expect(result.decisionReferences).toHaveLength(3)
  })

  it("never treats zero mandatory requirements as automatic approval", () => {
    expect(() => assertRegulatoryExecutionClearance(context, [], [], now)).toThrow(
      "required-check set",
    )
  })

  it("holds missing, ambiguous and duplicated evidence", () => {
    expect(() => assertRegulatoryExecutionClearance(context, checks, resolved().slice(0, 2), now))
      .toThrow("missing mandatory")
    expect(() =>
      assertRegulatoryExecutionClearance(context, checks, [...resolved(), evidence(checks[0])], now),
    ).toThrow("duplicate")
    expect(() =>
      assertRegulatoryExecutionClearance(context, [...checks, checks[0]], resolved(), now),
    ).toThrow("duplicate")
  })

  it("refuses cross-tenant, cross-seller, cross-buyer and wrong trade context", () => {
    for (const field of [
      "tenantId", "transactionReference", "sellerLegalEntityId", "buyerOrganisationId",
      "originCountry", "destinationCountry", "marketId", "productId",
    ] as const) {
      const cross = { ...evidence(checks[0]), [field]: "FOREIGN" }
      expect(() =>
        assertRegulatoryExecutionClearance(context, checks, [cross, ...resolved().slice(1)], now),
      ).toThrow("foreign regulatory context")
    }
  })

  it("holds conditions, reviews, blocks and unknown provider statuses", () => {
    for (const status of [
      "PASS_WITH_CONDITIONS", "REVIEW_REQUIRED", "BLOCKED", "EXPIRED", "ERROR",
      "UNKNOWN",
    ] as const) {
      expect(() => assertRegulatoryExecutionClearance(
        context,
        checks,
        [{ ...evidence(checks[0]), status: status as RegulatoryEvidence["status"] }, ...resolved().slice(1)],
        now,
      )).toThrow("not cleared")
    }
  })

  it("rejects future dated, expired and impossible provider decision dates", () => {
    expect(() =>
      assertRegulatoryExecutionClearance(context, checks, [
        { ...evidence(checks[0]), decidedAt: "2026-11-10T00:00:00Z" },
        ...resolved().slice(1),
      ], now),
    ).toThrow("stale or future")
    expect(() =>
      assertRegulatoryExecutionClearance(context, checks, [
        { ...evidence(checks[0]), expiresAt: now },
        ...resolved().slice(1),
      ], now),
    ).toThrow("stale")
    expect(() =>
      assertRegulatoryExecutionClearance(context, checks, [
        { ...evidence(checks[0]), decidedAt: "2026-02-30T00:00:00Z" },
        ...resolved().slice(1),
      ], now),
    ).toThrow("invalid decision time")
  })

  it("requires provider, CP binding, decision, evidence and rule version provenance", () => {
    for (const field of [
      "providerId", "bindingReference", "decisionReference", "evidenceReference", "ruleVersion",
    ] as const) {
      expect(() =>
        assertRegulatoryExecutionClearance(context, checks, [
          { ...evidence(checks[0]), [field]: "" },
          ...resolved().slice(1),
        ], now),
      ).toThrow("missing or invalid")
    }
  })

  it("refuses a single reused approval reference for several independent controls", () => {
    expect(() =>
      assertRegulatoryExecutionClearance(context, checks, [
        evidence(checks[0]),
        { ...evidence(checks[1]), decisionReference: "decision-" + checks[0] },
        evidence(checks[2]),
      ], now),
    ).toThrow("reused")
  })
})
