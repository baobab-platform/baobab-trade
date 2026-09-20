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
      .filter((item) => !item.expires_at || new Date(item.expires_at).valueOf() > now)
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
