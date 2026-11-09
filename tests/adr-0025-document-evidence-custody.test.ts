import { describe, expect, it } from "vitest"
import {
  assertDocumentPackageRelease,
  type TradeDocumentEvidence,
  type RequiredDocument,
} from "../src/baobab/trade-documents/evidence-release-guard"

const scope = { tenantId: "zb-tenant", legalEntityId: "zb-ug", transactionId: "export-1" }
const invoice: TradeDocumentEvidence = {
  ...scope, canonicalDocumentId: "doc-trade-invoice-1", sourceSystem: "ERP",
  sourceDocumentId: "idempiere-inv-1", documentType: "COMMERCIAL_INVOICE", version: 1,
  contentReference: "object-receipt-invoice-1", contentSha256: "a".repeat(64),
  custodyVerificationReference: "custody-1", issuerReference: "zb-ug",
  issuedAt: "2026-11-09T10:00:00Z", validUntil: "2027-01-01T00:00:00Z",
  status: "ISSUED", verificationState: "VERIFIED",
}
const certificate: TradeDocumentEvidence = {
  ...invoice, canonicalDocumentId: "doc-origin-1",
  sourceSystem: "REGULATORY_PROVIDER", sourceDocumentId: "origin-cert-1",
  documentType: "CERTIFICATE_OF_ORIGIN", custodyVerificationReference: "custody-2",
}
const required: RequiredDocument[] = [
  { documentType: "COMMERCIAL_INVOICE", acceptedIssuerSystems: ["ERP"] },
  { documentType: "CERTIFICATE_OF_ORIGIN", acceptedIssuerSystems: ["REGULATORY_PROVIDER"] },
]
const now = "2026-11-09T12:00:00Z"
const release = (docs: TradeDocumentEvidence[] = [invoice, certificate]) =>
  assertDocumentPackageRelease(scope, required, docs, now)

describe("ADR-0025 trade document and evidence custody", () => {
  it("accepts only current, versioned, independently verified required documents", () => {
    expect(release()).toEqual({
      documentVersions: ["doc-trade-invoice-1:1", "doc-origin-1:1"],
      custodyReferences: ["custody-1", "custody-2"],
    })
  })
  it("does not treat uploaded or unverified content as evidence", () => {
    for (const verificationState of ["PENDING", "UNVERIFIED", "REJECTED", "REVOKED"] as const)
      expect(() => release([{ ...invoice, verificationState }, certificate])).toThrow(
        "not verified",
      )
    expect(() => release([{ ...invoice, status: "REVOKED" }, certificate])).toThrow("not verified")
  })
  it("rejects missing, duplicate and foreign business-scope required documents", () => {
    expect(() => release([invoice])).toThrow("missing")
    expect(() => release([invoice, invoice, certificate])).toThrow("ambiguous")
    for (const field of ["tenantId", "legalEntityId", "transactionId"] as const)
      expect(() => release([{ ...invoice, [field]: "foreign" }, certificate])).toThrow("foreign")
  })
  it("requires immutable version, checksum and independent custody proof", () => {
    expect(() => release([{ ...invoice, version: 0 }, certificate])).toThrow("version")
    expect(() => release([{ ...invoice, contentSha256: "not-a-hash" }, certificate])).toThrow(
      "checksum",
    )
    expect(() => release([{ ...invoice, custodyVerificationReference: "" }, certificate])).toThrow(
      "invalid",
    )
  })
  it("rejects source authority substitution and provider-native IDs pretending to be canonical", () => {
    expect(() => release([{ ...invoice, sourceSystem: "TRADE" }, certificate])).toThrow(
      "unapproved document source",
    )
    expect(() =>
      release([{ ...invoice, canonicalDocumentId: invoice.sourceDocumentId }, certificate]),
    ).toThrow("canonical document identity")
  })
  it("holds expired, future-dated, revoked and superseded content", () => {
    expect(() => release([{ ...invoice, validUntil: now }, certificate])).toThrow("not effective")
    expect(() =>
      release([{ ...invoice, issuedAt: "2026-11-10T00:00:00Z" }, certificate]),
    ).toThrow("not effective")
    expect(() => release([{ ...invoice, status: "SUPERSEDED" }, certificate])).toThrow(
      "not verified",
    )
  })
  it("never assumes an empty requirement list is proof that the package is complete", () => {
    expect(() => assertDocumentPackageRelease(scope, [], [invoice], now)).toThrow(
      "policy absent",
    )
  })
  it("rejects reuse of the same custody receipt for distinct required artifacts", () => {
    expect(() => release([invoice, { ...certificate, custodyVerificationReference: "custody-1" }]))
      .toThrow("custody proof reused")
  })
})
