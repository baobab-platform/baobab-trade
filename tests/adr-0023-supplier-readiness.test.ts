import { describe, expect, it } from "vitest"
import {
  assertSupplierProcurementReadiness,
  type SupplierProcurementScope,
  type OwnerAttestation,
  type SupplierReadinessEvidence,
  type SupplierQualificationReceipt,
} from "../src/baobab/b2b/supplier-readiness-guard"

const scope: SupplierProcurementScope = {
  tenantId: "zuribeans", buyerLegalEntityId: "zb-ug",
  marketId: "UG", canonicalSupplierOrganisationId: "cooperative-42", productId: "coffee-1",
}
const attestation = (authority: OwnerAttestation["authority"], status: string): OwnerAttestation => ({
  ...scope, authority, status, reference: authority + "-receipt",
  version: "v2", observedAt: "2026-11-09T08:00:00Z",
  validUntil: "2026-11-10T00:00:00Z",
})
const qualification = (type: string): SupplierQualificationReceipt => ({
  ...scope, qualificationType: type, status: "PASSED",
  approvalReference: "approval-" + type, submittedBy: "supplier-officer",
  decidedBy: "independent-approver", evidenceReference: "evidence-" + type,
  effectiveFrom: "2026-11-09T08:00:00Z", expiresAt: "2026-11-10T00:00:00Z",
})
const valid = (): SupplierReadinessEvidence => ({
  cpIdentity: attestation("CP", "VERIFIED_SUPPLIER_ROLE"),
  tradeRelationship: attestation("TRADE", "ACTIVE"),
  erpVendor: attestation("ERP", "VENDOR_READY"),
  compliance: attestation("COMPLIANCE", "PASS"),
  iamPortal: attestation("IAM", "ACTIVE"),
  qualificationReceipts: [qualification("FOOD_SAFETY"), qualification("QUALITY")],
})
const now = "2026-11-09T12:00:00Z"
const decide = (e: SupplierReadinessEvidence, req = ["FOOD_SAFETY", "QUALITY"]) =>
  assertSupplierProcurementReadiness(scope, e, req, now, true)

describe("ADR-0023 federated supplier master readiness", () => {
  it("accepts only separate current CP/Trade/ERP/compliance/IAM and scoped qualification receipts", () => {
    expect(decide(valid())).toEqual({
      canonicalSupplierOrganisationId: "cooperative-42",
      qualificationReferences: ["approval-FOOD_SAFETY", "approval-QUALITY"],
    })
  })
  it("registration and supplier identity cannot substitute for approval or ERP vendor readiness", () => {
    expect(() => decide({ ...valid(), tradeRelationship: attestation("TRADE", "REGISTERED") }))
      .toThrow("TRADE")
    expect(() => decide({ ...valid(), erpVendor: attestation("ERP", "PROJECTION_PENDING") }))
      .toThrow("ERP")
    expect(() => decide({ ...valid(), cpIdentity: attestation("CP", "VERIFIED_IDENTITY") }))
      .toThrow("CP")
  })
  it("does not inherit a sibling tenant, legal entity, product or Market qualification", () => {
    for (const key of [
      "tenantId", "buyerLegalEntityId", "marketId", "canonicalSupplierOrganisationId", "productId",
    ] as const) {
      expect(() =>
        decide({ ...valid(), erpVendor: { ...attestation("ERP", "VENDOR_READY"), [key]: "sibling" } }),
      ).toThrow("foreign supplier evidence")
      expect(() => decide({
        ...valid(), qualificationReceipts: [
          { ...qualification("FOOD_SAFETY"), [key]: "sibling" },
          qualification("QUALITY"),
        ],
      })).toThrow("foreign supplier evidence")
    }
  })
  it("enforces qualification type, expiry, evidence provenance and independent approval", () => {
    expect(() => decide({ ...valid(), qualificationReceipts: [qualification("QUALITY")] }))
      .toThrow("missing or ambiguous")
    expect(() => decide({
      ...valid(), qualificationReceipts: [
        { ...qualification("FOOD_SAFETY"), status: "WAIVED" }, qualification("QUALITY"),
      ],
    })).toThrow("not passed")
    expect(() => decide({
      ...valid(), qualificationReceipts: [
        { ...qualification("FOOD_SAFETY"), decidedBy: "supplier-officer" }, qualification("QUALITY"),
      ],
    })).toThrow("self-approval")
    expect(() => decide({
      ...valid(), qualificationReceipts: [
        { ...qualification("FOOD_SAFETY"), expiresAt: now }, qualification("QUALITY"),
      ],
    })).toThrow("expired")
  })
  it("requires qualified portal IAM when acting through a supplier portal", () => {
    expect(() => decide({ ...valid(), iamPortal: undefined })).toThrow("IAM evidence")
    expect(() =>
      assertSupplierProcurementReadiness(scope, { ...valid(), iamPortal: undefined }, [
        "FOOD_SAFETY", "QUALITY",
      ], now, false),
    ).not.toThrow()
  })
  it("refuses missing policy, duplicate approvals and expired owner evidence", () => {
    expect(() => decide(valid(), [])).toThrow("policy missing")
    expect(() => decide(valid(), ["QUALITY", "QUALITY"])).toThrow("duplicate")
    expect(() => decide({
      ...valid(), tradeRelationship: {
        ...attestation("TRADE", "ACTIVE"), validUntil: now,
      },
    })).toThrow("expired")
  })
})
