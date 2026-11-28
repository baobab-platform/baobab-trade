import { describe, expect, it } from "vitest"
import {
  assertSupplierProcurementReadiness,
  type SupplierProcurementScope,
  type OwnerAttestation,
  type SupplierReadinessEvidence,
  type SupplierQualificationReceipt,
  type SupplierQualificationPolicy,
  type SupplierOwnerAuthority,
  type SupplierAttestationType,
} from "../src/baobab/b2b/supplier-readiness-guard"

const scope: SupplierProcurementScope = {
  tenantId: "zuribeans",
  buyerLegalEntityId: "zb-ug",
  supplierLegalEntityId: "supplier-legal-ug",
  marketId: "market-ug",
  marketRevision: 4,
  canonicalSupplierOrganisationId: "cooperative-42",
  productId: "coffee-1",
  supplierProductReference: "AA-Washed-01",
  originCountry: "UG",
  destinationCountry: "UG",
}
const attestation = (
  authority: SupplierOwnerAuthority,
  attestationType: SupplierAttestationType,
  status: string,
): OwnerAttestation => ({
  ...scope,
  authority,
  attestationType,
  status,
  reference: authority + "-" + attestationType + "-receipt",
  version: "v2",
  observedAt: "2026-11-09T08:00:00Z",
  validUntil: "2026-11-10T00:00:00Z",
})
const qualification = (type: string): SupplierQualificationReceipt => ({
  ...scope,
  qualificationType: type,
  status: "PASSED",
  approvalReference: "approval-" + type,
  submittedBy: "supplier-officer",
  decidedBy: "trade-approver",
  deciderAuthority: "TRADE",
  deciderRole: "QUALITY_APPROVER",
  evidenceReference: "evidence-" + type,
  effectiveFrom: "2026-11-09T08:00:00Z",
  expiresAt: "2026-11-10T00:00:00Z",
})
const policy: SupplierQualificationPolicy = {
  ...scope,
  policyReference: "qualification-policy-za-4",
  policyVersion: "v3",
  requiredQualificationTypes: ["FOOD_SAFETY", "QUALITY"],
}
const valid = (): SupplierReadinessEvidence => ({
  cpIdentity: attestation("CP", "CANONICAL_SUPPLIER_ROLE", "VERIFIED_SUPPLIER_ROLE"),
  tradeRelationship: attestation("TRADE", "ACTIVE_TRADE_RELATIONSHIP", "ACTIVE"),
  tradeProductCapability: attestation("TRADE", "PRODUCT_CAPABILITY", "CAPABLE"),
  tradeMarketEligibility: attestation("TRADE", "MARKET_ELIGIBILITY", "ELIGIBLE"),
  erpVendor: attestation("ERP", "ERP_VENDOR_READY", "VENDOR_READY"),
  compliance: attestation("COMPLIANCE", "COMPLIANCE_CLEARANCE", "PASS"),
  iamPortal: attestation("IAM", "IAM_PORTAL_ACCESS", "ACTIVE"),
  qualificationReceipts: [qualification("FOOD_SAFETY"), qualification("QUALITY")],
})
const now = "2026-11-09T12:00:00Z"
const decide = (
  evidence: SupplierReadinessEvidence,
  expected = scope,
  qualificationPolicy = policy,
  requirePortalIdentity = true,
) => assertSupplierProcurementReadiness(
  expected,
  evidence,
  qualificationPolicy,
  now,
  requirePortalIdentity,
)

describe("ADR-0023 federated supplier master readiness", () => {
  it("accepts separate current CP, Trade, ERP, compliance, IAM and scoped qualification receipts", () => {
    const result = decide(valid())
    expect(result.canonicalSupplierOrganisationId).toBe("cooperative-42")
    expect(result.qualificationPolicyReference).toBe(policy.policyReference)
    expect(result.qualificationReferences.map((item) => item.qualificationType)).toEqual([
      "FOOD_SAFETY",
      "QUALITY",
    ])
    expect(result.ownerAttestations.map((item) => item.attestationType)).toEqual([
      "CANONICAL_SUPPLIER_ROLE",
      "ACTIVE_TRADE_RELATIONSHIP",
      "PRODUCT_CAPABILITY",
      "MARKET_ELIGIBILITY",
      "ERP_VENDOR_READY",
      "COMPLIANCE_CLEARANCE",
      "IAM_PORTAL_ACCESS",
    ])
  })

  it("registration, identity and ERP presence cannot substitute for approval or product/market eligibility", () => {
    expect(() => decide({
      ...valid(),
      tradeRelationship: attestation("TRADE", "ACTIVE_TRADE_RELATIONSHIP", "REGISTERED"),
    })).toThrow("ACTIVE_TRADE_RELATIONSHIP")
    expect(() => decide({
      ...valid(),
      erpVendor: attestation("ERP", "ERP_VENDOR_READY", "PROJECTION_PENDING"),
    })).toThrow("ERP_VENDOR_READY")
    expect(() => decide({
      ...valid(),
      cpIdentity: attestation("CP", "CANONICAL_SUPPLIER_ROLE", "VERIFIED_IDENTITY"),
    })).toThrow("CANONICAL_SUPPLIER_ROLE")
    expect(() => decide({
      ...valid(),
      tradeProductCapability: attestation("TRADE", "PRODUCT_CAPABILITY", "UNQUALIFIED"),
    })).toThrow("PRODUCT_CAPABILITY")
    expect(() => decide({
      ...valid(),
      tradeMarketEligibility: attestation("TRADE", "MARKET_ELIGIBILITY", "NOT_ELIGIBLE"),
    })).toThrow("MARKET_ELIGIBILITY")
  })

  it("does not inherit sibling tenant, buyer/supplier LegalEntity, Market, product, origin or trade-lane evidence", () => {
    const changes: Partial<SupplierProcurementScope>[] = [
      { tenantId: "tenant-other" },
      { buyerLegalEntityId: "buyer-other" },
      { supplierLegalEntityId: "supplier-legal-other" },
      { marketId: "market-other" },
      { marketRevision: 5 },
      { canonicalSupplierOrganisationId: "supplier-other" },
      { productId: "product-other" },
      { supplierProductReference: "supplier-sku-other" },
      { originCountry: "KE", tradeLaneId: "lane-ke-ug" },
      { destinationCountry: "ZA", tradeLaneId: "lane-ug-za" },
      { tradeLaneId: "lane-other" },
    ]
    for (const change of changes) {
      const foreign = { ...scope, ...change }
      const foreignEvidence = {
        ...valid(),
        erpVendor: attestation("ERP", "ERP_VENDOR_READY", "VENDOR_READY"),
      }
      expect(() => decide(foreignEvidence, foreign)).toThrow("foreign supplier evidence")
    }
    expect(() => decide({
      ...valid(),
      qualificationReceipts: [
        { ...qualification("FOOD_SAFETY"), productId: "product-other" },
        qualification("QUALITY"),
      ],
    })).toThrow("foreign supplier evidence")
  })

  it("enforces exact qualification policy scope and a nonempty unique required type set", () => {
    expect(() => decide(valid(), scope, { ...policy, marketRevision: 3 })).toThrow(
      "foreign supplier evidence",
    )
    expect(() => decide(valid(), scope, { ...policy, requiredQualificationTypes: [] })).toThrow(
      "required qualification policy",
    )
    expect(() => decide(valid(), scope, {
      ...policy,
      requiredQualificationTypes: ["QUALITY", "QUALITY"],
    })).toThrow("duplicate")
  })

  it("requires exactly one passed qualification with current evidence and independent Trade approval", () => {
    expect(() => decide({
      ...valid(),
      qualificationReceipts: [qualification("QUALITY")],
    })).toThrow("missing or ambiguous")
    expect(() => decide({
      ...valid(),
      qualificationReceipts: [
        qualification("FOOD_SAFETY"),
        { ...qualification("QUALITY"), status: "WAIVED" },
      ],
    })).toThrow("not passed")
    expect(() => decide({
      ...valid(),
      qualificationReceipts: [
        qualification("FOOD_SAFETY"),
        { ...qualification("QUALITY"), status: "PASSED_WITH_CONDITIONS" },
      ],
    })).toThrow("not passed")
    expect(() => decide({
      ...valid(),
      qualificationReceipts: [
        qualification("FOOD_SAFETY"),
        { ...qualification("QUALITY"), decidedBy: "supplier-officer" },
      ],
    })).toThrow("independent authorised Trade approval")
    expect(() => decide({
      ...valid(),
      qualificationReceipts: [
        qualification("FOOD_SAFETY"),
        { ...qualification("QUALITY"), expiresAt: now },
      ],
    })).toThrow("expired")
  })

  it("rejects reused approval/evidence references and malformed owner expiry", () => {
    expect(() => decide({
      ...valid(),
      qualificationReceipts: [
        qualification("FOOD_SAFETY"),
        { ...qualification("QUALITY"), approvalReference: "approval-FOOD_SAFETY" },
      ],
    })).toThrow("reused")
    expect(() => decide({
      ...valid(),
      qualificationReceipts: [
        qualification("FOOD_SAFETY"),
        { ...qualification("QUALITY"), evidenceReference: "evidence-FOOD_SAFETY" },
      ],
    })).toThrow("reused")
    expect(() => decide({
      ...valid(),
      tradeRelationship: {
        ...attestation("TRADE", "ACTIVE_TRADE_RELATIONSHIP", "ACTIVE"),
        validUntil: now,
      },
    })).toThrow("expired")
  })

  it("requires IAM only for supplier-portal operations", () => {
    expect(() => decide({ ...valid(), iamPortal: undefined })).toThrow("IAM")
    expect(() =>
      decide({ ...valid(), iamPortal: undefined }, scope, policy, false),
    ).not.toThrow()
  })

  it("requires a Trade Lane for cross-border supplier capability", () => {
    const crossBorder = {
      ...scope,
      destinationCountry: "ZA",
      tradeLaneId: undefined,
    }
    expect(() => decide(valid(), crossBorder)).toThrow("cross-border supplier scope")
    const validCrossBorder = { ...crossBorder, tradeLaneId: "lane-ug-za" }
    const evidence = {
      ...valid(),
      cpIdentity: { ...valid().cpIdentity, ...validCrossBorder },
      tradeRelationship: { ...valid().tradeRelationship, ...validCrossBorder },
      tradeProductCapability: { ...valid().tradeProductCapability, ...validCrossBorder },
      tradeMarketEligibility: { ...valid().tradeMarketEligibility, ...validCrossBorder },
      erpVendor: { ...valid().erpVendor, ...validCrossBorder },
      compliance: { ...valid().compliance, ...validCrossBorder },
      iamPortal: { ...valid().iamPortal!, ...validCrossBorder },
      qualificationReceipts: [
        { ...qualification("FOOD_SAFETY"), ...validCrossBorder },
        { ...qualification("QUALITY"), ...validCrossBorder },
      ],
    }
    expect(decide(evidence, validCrossBorder).scope.tradeLaneId).toBe("lane-ug-za")
  })
})
