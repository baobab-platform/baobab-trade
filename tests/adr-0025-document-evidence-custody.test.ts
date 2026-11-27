import { describe, expect, it } from "vitest"
import {
  assertDocumentPackageRelease,
  type TradeDocumentEvidence,
  type DocumentBusinessScope,
  type DocumentRequirementPolicy,
  type RequiredDocument,
} from "../src/baobab/trade-documents/evidence-release-guard"

const scope: DocumentBusinessScope = {
  tenantId: "zb-tenant",
  legalEntityId: "zb-ug",
  legalEntityRole: "SELLER",
  transactionId: "export-1",
  marketId: "market-ug",
  marketRevision: 4,
  shipmentId: "shipment-1",
  tradeLaneId: "lane-ug-za",
  productId: "coffee-1",
}
const invoice: TradeDocumentEvidence = {
  ...scope,
  canonicalDocumentId: "doc-trade-invoice-1",
  sourceSystem: "ERP",
  sourceDocumentId: "idempiere-inv-1",
  documentType: "COMMERCIAL_INVOICE",
  version: 1,
  contentReference: "object-receipt-invoice-1",
  contentSha256: "a".repeat(64),
  custodyVerificationReference: "custody-1",
  issuerAuthority: "ERP",
  issuerReference: "erp-issuer-1",
  issuedAt: "2026-11-09T10:00:00Z",
  validUntil: "2027-01-01T00:00:00Z",
  status: "ISSUED",
  verificationState: "VERIFIED",
}
const certificate: TradeDocumentEvidence = {
  ...invoice,
  canonicalDocumentId: "doc-origin-1",
  sourceSystem: "REGULATORY_PROVIDER",
  sourceDocumentId: "origin-cert-1",
  documentType: "CERTIFICATE_OF_ORIGIN",
  custodyVerificationReference: "custody-2",
  issuerAuthority: "REGULATORY_AUTHORITY",
  issuerReference: "customs-authority-ug",
}
const required: RequiredDocument[] = [
  {
    documentType: "COMMERCIAL_INVOICE",
    mandatory: true,
    acceptedIssuerSystems: ["ERP"],
    acceptedIssuerAuthorities: ["ERP"],
    acceptedIssuerReferences: ["erp-issuer-1"],
  },
  {
    documentType: "CERTIFICATE_OF_ORIGIN",
    mandatory: true,
    acceptedIssuerSystems: ["REGULATORY_PROVIDER"],
    acceptedIssuerAuthorities: ["REGULATORY_AUTHORITY"],
  },
]
const policy: DocumentRequirementPolicy = {
  ...scope,
  policyReference: "document-policy-export-4",
  policyVersion: "v2",
  effectiveFrom: "2026-01-01T00:00:00Z",
  validUntil: "2027-01-01T00:00:00Z",
  requirements: required,
}
const now = "2026-11-09T12:00:00Z"
const release = (
  docs: TradeDocumentEvidence[] = [invoice, certificate],
  requirementPolicy = policy,
  expectedScope = scope,
) => assertDocumentPackageRelease(expectedScope, requirementPolicy, docs, now)

describe("ADR-0025 trade document and evidence custody", () => {
  it("accepts only current, versioned, issuer-constrained and independently verified required documents", () => {
    const result = release()
    expect(result.requirementPolicyReference).toBe(policy.policyReference)
    expect(result.requirementPolicyVersion).toBe(policy.policyVersion)
    expect(result.acceptedDocuments.map((item) => item.canonicalDocumentId)).toEqual([
      "doc-trade-invoice-1",
      "doc-origin-1",
    ])
    expect(result.acceptedDocuments.map((item) => item.custodyVerificationReference)).toEqual([
      "custody-1",
      "custody-2",
    ])
  })

  it("does not treat uploaded, unverified, revoked or disputed content as evidence", () => {
    for (const verificationState of ["PENDING", "UNVERIFIED", "REJECTED", "REVOKED", "EXPIRED", "DISPUTED"] as const)
      expect(() => release([{ ...invoice, verificationState }, certificate])).toThrow(
        "document status",
      )
    expect(() => release([{ ...invoice, status: "REVOKED" }, certificate])).toThrow("document status")
  })

  it("rejects missing, duplicate, extra and foreign business-scope documents", () => {
    expect(() => release([invoice])).toThrow("exactly cover")
    expect(() => release([
      invoice,
      { ...invoice, canonicalDocumentId: "doc-invoice-duplicate", sourceDocumentId: "inv-duplicate" },
    ])).toThrow("duplicate document type")
    expect(() => release([invoice, certificate, { ...certificate, canonicalDocumentId: "extra" }]))
      .toThrow("exactly cover")
    for (const field of [
      "tenantId",
      "legalEntityId",
      "legalEntityRole",
      "transactionId",
      "marketId",
      "marketRevision",
      "shipmentId",
      "tradeLaneId",
      "productId",
    ] as const) {
      const value = field === "marketRevision" ? 5 : "foreign"
      expect(() => release([{ ...invoice, [field]: value }, certificate])).toThrow(
        "foreign document business scope",
      )
    }
  })

  it("requires immutable version, checksum, canonical identity and custody proof", () => {
    expect(() => release([{ ...invoice, version: 0 }, certificate])).toThrow("document status")
    expect(() => release([{ ...invoice, contentSha256: "not-a-hash" }, certificate])).toThrow(
      "document status",
    )
    expect(() => release([{ ...invoice, custodyVerificationReference: "" }, certificate])).toThrow(
      "invalid custody",
    )
    expect(() => release([
      { ...invoice, canonicalDocumentId: invoice.sourceDocumentId },
      certificate,
    ])).toThrow("document status")
  })

  it("enforces accepted issuer authority, source system and optional exact issuer reference", () => {
    expect(() => release([{ ...invoice, sourceSystem: "TRADE" }, certificate])).toThrow(
      "document status",
    )
    expect(() => release([{ ...invoice, issuerAuthority: "SUPPLIER" }, certificate])).toThrow(
      "document status",
    )
    expect(() => release([{ ...invoice, issuerReference: "other-erp" }, certificate])).toThrow(
      "document status",
    )
  })

  it("holds expired, future-dated, revoked and superseded content", () => {
    expect(() => release([{ ...invoice, validUntil: now }, certificate])).toThrow(
      "not currently effective",
    )
    expect(() =>
      release([{ ...invoice, issuedAt: "2026-11-10T00:00:00Z" }, certificate]),
    ).toThrow("not currently effective")
    expect(() => release([{ ...invoice, status: "SUPERSEDED" }, certificate])).toThrow(
      "document status",
    )
  })

  it("supports documents without an expiry while retaining issue/effective dating", () => {
    expect(release([{ ...invoice, validUntil: null }, certificate]).acceptedDocuments).toHaveLength(2)
    expect(() =>
      release([{ ...invoice, validFrom: "2026-11-10T00:00:00Z" }, certificate]),
    ).toThrow("not currently effective")
  })

  it("never assumes an empty, foreign or expired requirement policy means the package is complete", () => {
    expect(() => release([invoice, certificate], { ...policy, requirements: [] })).toThrow(
      "policy absent",
    )
    expect(() => release([invoice, certificate], { ...policy, marketRevision: 3 })).toThrow(
      "foreign document requirement policy scope",
    )
    expect(() => release([invoice, certificate], {
      ...policy,
      validUntil: now,
    })).toThrow("policy is not currently effective")
  })

  it("rejects reuse of canonical, source or custody references across required artifacts", () => {
    expect(() => release([
      invoice,
      { ...certificate, canonicalDocumentId: invoice.canonicalDocumentId },
    ])).toThrow("document status")
    expect(() => release([
      invoice,
      { ...certificate, sourceDocumentId: invoice.sourceDocumentId },
    ])).toThrow("document status")
    expect(() => release([
      invoice,
      { ...certificate, custodyVerificationReference: "custody-1" },
    ])).toThrow("document status")
  })
})
