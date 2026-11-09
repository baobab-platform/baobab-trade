import { describe, expect, it } from "vitest"
import {
  snapshotDeliveryAgreement, assertActualRiskMilestone,
  type IncotermAgreement, type RiskMilestoneEvidence,
} from "../src/baobab/trade-readiness/incoterm-agreement"
import { validateCrossBorderMetadata } from "../src/baobab/trade-readiness/trade-metadata"

const agreement: IncotermAgreement = {
  tenantId: "zb-tenant", transactionReference: "order-50", shipmentReference: "shipment-20",
  code: "CIF", rulesVersion: "2020",
  namedPlace: { canonicalLocationId: "port-durban", name: "Durban", country: "ZA" },
  transportMode: "SEA", deliveryRuleProviderReference: "governed-rule-provider",
  deliveryRuleVersion: "incoterm-2020-v1", titlePolicyReference: "separate-title-clause",
  paymentTermsReference: "net30-contract", taxContextReference: "sars-tax-context",
}
const event: RiskMilestoneEvidence = {
  tenantId: agreement.tenantId, transactionReference: agreement.transactionReference,
  shipmentReference: agreement.shipmentReference, milestoneType: "ON_BOARD",
  eventReference: "carrier-shipped-22", evidenceReference: "signed-bl-reference",
  observedAt: "2026-11-09T12:00:00Z", actual: true,
  providerReference: "cp-carrier-1", rulesVersion: agreement.deliveryRuleVersion,
}
const now = "2026-11-09T13:00:00Z"

describe("ADR-0026 delivery, risk and title separation", () => {
  it("captures a versioned maritime rule and structured named destination", () => {
    expect(snapshotDeliveryAgreement(agreement).snapshot).toEqual(agreement)
    expect(snapshotDeliveryAgreement(agreement).fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })
  it("does not accept unversioned or unnamed contractual delivery terms", () => {
    expect(() => snapshotDeliveryAgreement({ ...agreement, rulesVersion: "2010" as "2020" }))
      .toThrow("rules code/version")
    expect(() => snapshotDeliveryAgreement({
      ...agreement, namedPlace: { ...agreement.namedPlace, name: "" },
    })).toThrow("named place")
    expect(() => snapshotDeliveryAgreement({
      ...agreement, titlePolicyReference: "",
    })).toThrow("titlePolicyReference")
  })
  it("requires maritime modes for FAS, FOB, CFR and CIF", () => {
    for (const code of ["FAS", "FOB", "CFR", "CIF"] as const)
      expect(() => snapshotDeliveryAgreement({
        ...agreement, code, transportMode: "ROAD",
      })).toThrow("maritime-only")
    expect(snapshotDeliveryAgreement({ ...agreement, code: "FCA", transportMode: "ROAD" }))
      .toBeDefined()
  })
  it("supports all eleven Incoterms 2020 without making transport mode a title decision", () => {
    for (const code of ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP"] as const)
      expect(snapshotDeliveryAgreement({ ...agreement, code, transportMode: "MULTIMODAL" }))
        .toBeDefined()
  })
  it("requires a real observed carrier milestone and explicitly leaves title unchanged", () => {
    expect(assertActualRiskMilestone(agreement, "ON_BOARD", event, now)).toEqual({
      riskMilestoneReference: "carrier-shipped-22", titleChanged: false,
    })
    expect(() =>
      assertActualRiskMilestone(agreement, "ON_BOARD", { ...event, actual: false }, now),
    ).toThrow("planned")
    expect(() =>
      assertActualRiskMilestone(agreement, "ON_BOARD", {
        ...event, observedAt: "2026-11-10T13:00:00Z",
      }, now),
    ).toThrow("future")
  })
  it("rejects foreign tenant/transaction/shipment and non-matching rule/milestone", () => {
    for (const field of [
      "tenantId", "transactionReference", "shipmentReference", "rulesVersion", "milestoneType",
    ] as const) {
      expect(() => assertActualRiskMilestone(agreement, "ON_BOARD", {
        ...event, [field]: "foreign",
      }, now)).toThrow("mismatched")
    }
  })
  it("validates all eleven Incoterms codes in the older cross-border metadata path", () => {
    // Only test the invalid-code rejection, before other required metadata checks.
    expect(() => validateCrossBorderMetadata({
      incoterm: "AAA" as "CIF", originCountry: "UG", destinationCountry: "ZA",
      digitalEstate: "estate", legalSellerKey: "seller", exporterOrganisationId: "exporter",
      importerOrganisationId: "importer", customsProcedureReference: "procedure",
      exportEligibilityReference: "export", exporterRegistrationReference: "expreg",
      importerRegistrationReference: "impreg", transactionReference: "tx", orderReference: "ord",
      marketKey: "UG", lines: [], idempotencyKey: "idem", correlationId: "corr",
    })).toThrow("Unsupported Incoterms")
  })
})
