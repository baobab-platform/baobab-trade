import { MedusaError } from "@medusajs/framework/utils"
import type B2BModuleService from "../../modules/b2b/service"

export const REQUIRED_BUYER_KYB_EVIDENCE = [
  "COMPANY_REGISTRATION",
  "TAX_REGISTRATION",
  "AUTHORIZED_REPRESENTATIVE",
] as const

export type BuyerKybEvidenceType =
  | (typeof REQUIRED_BUYER_KYB_EVIDENCE)[number]
  | "REGISTERED_ADDRESS"
  | "OWNERSHIP_STRUCTURE"
  | "BANK_ACCOUNT"
  | "OTHER"

export const isBuyerKybEvidenceType = (value: unknown): value is BuyerKybEvidenceType =>
  [
    ...REQUIRED_BUYER_KYB_EVIDENCE,
    "REGISTERED_ADDRESS",
    "OWNERSHIP_STRUCTURE",
    "BANK_ACCOUNT",
    "OTHER",
  ].includes(value as BuyerKybEvidenceType)

export const assertVerifiedBuyerKybPackage = async (
  b2b: B2BModuleService,
  applicationId: string,
  tenantId: string,
): Promise<void> => {
  const evidence = await b2b.listBuyerApplicationEvidences({
    application_id: applicationId,
    tenant_id: tenantId,
    status: "VERIFIED",
  })
  const now = Date.now()
  const verified = new Set(
    evidence
      .filter((item) => {
        // VERIFIED is necessary but not sufficient: a future-issued
        // certificate, malformed document hash or missing canonical identity
        // must never activate buyer review.
        const issued = item.issued_at ? new Date(item.issued_at).valueOf() : undefined
        const expires = item.expires_at ? new Date(item.expires_at).valueOf() : undefined
        return (
          (issued === undefined || (Number.isFinite(issued) && issued <= now)) &&
          (expires === undefined || (Number.isFinite(expires) && expires > now)) &&
          typeof item.canonical_document_id === "string" &&
          item.canonical_document_id.trim().length > 0 &&
          typeof item.document_version === "string" &&
          item.document_version.trim().length > 0 &&
          typeof item.content_sha256 === "string" &&
          /^[a-f0-9]{64}$/.test(item.content_sha256)
        )
      })
      .map((item) => item.evidence_type),
  )
  const missing = REQUIRED_BUYER_KYB_EVIDENCE.filter((type) => !verified.has(type))
  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `verified KYB evidence is incomplete: ${missing.join(", ")}`,
    )
  }
}
