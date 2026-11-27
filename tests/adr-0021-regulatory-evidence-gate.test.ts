import { describe, expect, it } from "vitest"
import {
  assertRegulatoryExecutionClearance,
  type RegulatoryContext,
  type RegulatoryEvidence,
  type RegulatoryCheck,
  type RequiredRegulatoryCheck,
} from "../src/baobab/trade-readiness/regulatory-evidence-gate"

const now = "2026-11-09T12:00:00Z"
const context: RegulatoryContext = {
  tenantId: "tenant-zb",
  transactionReference: "trade-order-1",
  sellerLegalEntityId: "zb-ug",
  buyerOrganisationId: "buyer-a",
  buyerLegalEntityId: "buyer-legal-a",
  marketId: "market-za",
  marketRevision: 3,
  shipmentOriginCountry: "UG",
  destinationCountry: "ZA",
  tradeLaneId: "lane-ug-za",
  incoterm: "CIF",
  customsOriginCountry: "UG",
  countryOfProduction: "UG",
  productId: "coffee-1",
  classificationSystem: "HS",
  classificationCode: "0901.11",
  classificationVersion: "2026",
  classificationReference: "classification-evidence-1",
}
const checks: RegulatoryCheck[] = [
  "PRODUCT_CLASSIFICATION",
  "EXPORT_ELIGIBILITY",
  "IMPORT_ELIGIBILITY",
]
const required: RequiredRegulatoryCheck[] = checks.map((check) => ({
  check,
  providerId: "provider-" + check,
  bindingReference: "binding-" + check,
  providerVersion: "provider-v1",
  bindingVersion: "binding-v1",
}))
const evidence = (check: RegulatoryCheck): RegulatoryEvidence => {
  const binding = required.find((item) => item.check === check)!
  return {
    ...context,
    context,
    check,
    status: "PASS",
    providerId: binding.providerId,
    bindingReference: binding.bindingReference,
    providerVersion: binding.providerVersion,
    bindingVersion: binding.bindingVersion,
    decisionReference: "decision-" + check,
    evidenceReference: "evidence-" + check,
    decidedAt: "2026-11-09T10:00:00Z",
    expiresAt: "2026-11-09T15:00:00Z",
  }
}
const resolved = () => checks.map(evidence)

describe("ADR-0021 provider regulatory clearance", () => {
  it("requires distinct fresh PASS evidence matching every CP-resolved provider binding", () => {
    const result = assertRegulatoryExecutionClearance(context, required, resolved(), now)
    expect(result.approvedChecks).toEqual(checks)
    expect(result.decisionReferences).toHaveLength(3)
    expect(result.evidenceReferences).toHaveLength(3)
    expect(result.providerBindings).toEqual(required)
  })

  it("never treats zero mandatory requirements as automatic approval", () => {
    expect(() => assertRegulatoryExecutionClearance(context, [], [], now)).toThrow(
      "required-check set",
    )
  })

  it("holds missing, ambiguous, duplicated and additional evidence", () => {
    expect(() =>
      assertRegulatoryExecutionClearance(context, required, resolved().slice(0, 2), now),
    ).toThrow("exactly cover")
    expect(() =>
      assertRegulatoryExecutionClearance(context, required, [...resolved(), evidence(checks[0])], now),
    ).toThrow("exactly cover")
    expect(() =>
      assertRegulatoryExecutionClearance(context, [...required, required[0]], resolved(), now),
    ).toThrow("duplicate")
    expect(() =>
      assertRegulatoryExecutionClearance(context, required, [
        evidence(checks[0]),
        evidence(checks[0]),
        evidence(checks[2]),
      ], now),
    ).toThrow("duplicate")
  })

  it("refuses cross-tenant, legal entity, buyer, Market, lane, origin, product and classification context", () => {
    const changes: Partial<RegulatoryContext>[] = [
      { tenantId: "tenant-other" },
      { transactionReference: "trade-order-other" },
      { sellerLegalEntityId: "seller-other" },
      { buyerOrganisationId: "buyer-other" },
      { buyerLegalEntityId: "buyer-legal-other" },
      { marketId: "market-other" },
      { marketRevision: 4 },
      { shipmentOriginCountry: "KE" },
      { destinationCountry: "KE" },
      { tradeLaneId: "lane-other" },
      { incoterm: "DAP" },
      { customsOriginCountry: "KE" },
      { countryOfProduction: "KE" },
      { productId: "product-other" },
      { classificationSystem: "OTHER" },
      { classificationCode: "0901.12" },
      { classificationVersion: "2025" },
      { classificationReference: "classification-other" },
    ]
    for (const change of changes) {
      const changedContext = { ...context, ...change }
      expect(() =>
        assertRegulatoryExecutionClearance(context, required, [
          { ...evidence(checks[0]), context: changedContext },
          ...resolved().slice(1),
        ], now),
      ).toThrow("mismatched regulatory transaction context")
    }
  })

  it("holds conditional, review, blocked, expired, error and no-provider outcomes", () => {
    for (const status of [
      "PASS_WITH_CONDITIONS",
      "REVIEW_REQUIRED",
      "BLOCKED",
      "EXPIRED",
      "ERROR",
      "NO_PROVIDER",
      "PENDING",
      "NOT_EVALUATED",
      "UNKNOWN",
    ] as const) {
      expect(() =>
        assertRegulatoryExecutionClearance(context, required, [
          { ...evidence(checks[0]), status: status as RegulatoryEvidence["status"] },
          ...resolved().slice(1),
        ], now),
      ).toThrow("not cleared")
    }
  })

  it("rejects future dated, expired and impossible provider decision dates", () => {
    expect(() =>
      assertRegulatoryExecutionClearance(context, required, [
        { ...evidence(checks[0]), decidedAt: "2026-11-10T00:00:00Z" },
        ...resolved().slice(1),
      ], now),
    ).toThrow("stale or future")
    expect(() =>
      assertRegulatoryExecutionClearance(context, required, [
        { ...evidence(checks[0]), expiresAt: now },
        ...resolved().slice(1),
      ], now),
    ).toThrow("stale or future")
    expect(() =>
      assertRegulatoryExecutionClearance(context, required, [
        { ...evidence(checks[0]), decidedAt: "2026-02-30T00:00:00Z" },
        ...resolved().slice(1),
      ], now),
    ).toThrow("invalid decision time")
  })

  it("requires exact provider ID, CP binding, provider version and binding version", () => {
    for (const change of [
      { providerId: "other-provider" },
      { bindingReference: "other-binding" },
      { providerVersion: "provider-v2" },
      { bindingVersion: "binding-v2" },
    ]) {
      expect(() =>
        assertRegulatoryExecutionClearance(context, required, [
          { ...evidence(checks[0]), ...change },
          ...resolved().slice(1),
        ], now),
      ).toThrow("CP-resolved binding")
    }
  })

  it("requires provider, binding, decision and evidence references", () => {
    for (const field of [
      "providerId",
      "bindingReference",
      "providerVersion",
      "bindingVersion",
      "decisionReference",
      "evidenceReference",
    ] as const) {
      expect(() =>
        assertRegulatoryExecutionClearance(context, required, [
          { ...evidence(checks[0]), [field]: "" },
          ...resolved().slice(1),
        ], now),
      ).toThrow("CP-resolved binding")
    }
  })

  it("rejects reused decision and evidence references across independent checks", () => {
    expect(() =>
      assertRegulatoryExecutionClearance(context, required, [
        evidence(checks[0]),
        { ...evidence(checks[1]), decisionReference: evidence(checks[0]).decisionReference },
        evidence(checks[2]),
      ], now),
    ).toThrow("reused")
    expect(() =>
      assertRegulatoryExecutionClearance(context, required, [
        evidence(checks[0]),
        { ...evidence(checks[1]), evidenceReference: evidence(checks[0]).evidenceReference },
        evidence(checks[2]),
      ], now),
    ).toThrow("reused")
  })

  it("requires cross-border Trade Lane and Incoterm, and check-specific classification/origin evidence", () => {
    expect(() =>
      assertRegulatoryExecutionClearance(
        { ...context, tradeLaneId: undefined },
        required,
        resolved(),
        now,
      ),
    ).toThrow("Trade Lane and Incoterm")
    expect(() =>
      assertRegulatoryExecutionClearance(
        { ...context, classificationReference: undefined },
        required,
        resolved(),
        now,
      ),
    ).toThrow("classification lacks")
    const originRequired = [{
      check: "ORIGIN" as const,
      providerId: "provider-origin",
      bindingReference: "binding-origin",
      providerVersion: "v1",
      bindingVersion: "b1",
    }]
    expect(() =>
      assertRegulatoryExecutionClearance(
        { ...context, customsOriginCountry: undefined },
        originRequired,
        [],
        now,
      ),
    ).toThrow("customs origin")
  })

  it("allows a domestic transaction without a cross-border Trade Lane", () => {
    const domestic = {
      ...context,
      shipmentOriginCountry: "ZA",
      destinationCountry: "ZA",
      tradeLaneId: undefined,
      incoterm: undefined,
    }
    const domesticRequired = [required[0]]
    const domesticEvidence = {
      ...evidence(checks[0]),
      context: domestic,
    }
    expect(
      assertRegulatoryExecutionClearance(domestic, domesticRequired, [domesticEvidence], now)
        .approvedChecks,
    ).toEqual([checks[0]])
  })
})
