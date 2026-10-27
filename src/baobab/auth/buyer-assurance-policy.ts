import { createHash } from "node:crypto"
import { buyerAssurancePolicySchema } from "../contracts/authority-validation"
import { CANONICAL_OPERATION_PROFILES, type AssuranceProfile } from "./buyer-assurance"

type Requirement = {
  accepted_acr_values: string[]
  required_methods?: string[]
  max_authentication_age_seconds?: number
  step_up_required: boolean
  phishing_resistant_required?: boolean
}
type PolicyDocument = {
  policy_id: string
  policy_version: number
  status: "DRAFT" | "APPROVED" | "SUSPENDED" | "RETIRED"
  issuer: string
  audience: "baobab-trade"
  approval_reference: string
  effective_from: string
  effective_until?: string
  profiles: Record<AssuranceProfile, Requirement>
  operation_profiles: typeof CANONICAL_OPERATION_PROFILES
}

/** A deployment-owned, approved policy snapshot; never read from a buyer request.
 * Approval records evidence supplied by the governing owner. This loader cannot
 * approve a policy or attest the issuer's meaning of an ACR/method itself. */
export type ApprovedBuyerAssurancePolicy = {
  kind: "APPROVED_POLICY"
  issuer: string
  approvalReference: string
  policyRevision: string
  effectiveFrom: number
  effectiveUntil: number
  profiles: Readonly<Record<AssuranceProfile, Readonly<Requirement>>>
}

/** Invalid explicit policy configuration fails closed; callers must never
 * fall back to the interim allowlist when an explicit policy was supplied. */
export function loadBuyerAssurancePolicy(
  json: string,
  trustedIssuer: string,
): ApprovedBuyerAssurancePolicy | null {
  try {
    if (Buffer.byteLength(json) > 64 * 1024) return null
    const value: unknown = JSON.parse(json)
    if (!buyerAssurancePolicySchema(value)) return null
    const doc = value as PolicyDocument
    const url = new URL(doc.issuer)
    if (
      doc.status !== "APPROVED" ||
      doc.issuer !== trustedIssuer ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      doc.issuer.trim() !== doc.issuer ||
      !doc.approval_reference.trim() ||
      !Number.isSafeInteger(doc.policy_version)
    )
      return null
    const effectiveFrom = Date.parse(doc.effective_from)
    const effectiveUntil =
      doc.effective_until === undefined ? Infinity : Date.parse(doc.effective_until)
    if (
      !Number.isFinite(effectiveFrom) ||
      Number.isNaN(effectiveUntil) ||
      effectiveUntil <= effectiveFrom
    )
      return null
    for (const profile of Object.values(doc.profiles)) {
      if (profile.accepted_acr_values.some((v) => v === "*" || v.trim() !== v)) return null
      if (profile.required_methods?.some((v) => v === "*" || v.trim() !== v)) return null
      if (
        profile.max_authentication_age_seconds !== undefined &&
        !Number.isSafeInteger(profile.max_authentication_age_seconds)
      )
        return null
      Object.freeze(profile.accepted_acr_values)
      if (profile.required_methods) Object.freeze(profile.required_methods)
      Object.freeze(profile)
    }
    // Fixed-length revision fits trade/v2's 128-character composed policy_revision
    // even at the maximum allowed policy ID length. It binds approval and version.
    const digest = createHash("sha256").update(JSON.stringify(doc)).digest("hex")
    return Object.freeze({
      kind: "APPROVED_POLICY",
      issuer: doc.issuer,
      approvalReference: doc.approval_reference,
      policyRevision: `assurance.sha256:${digest}`,
      effectiveFrom,
      effectiveUntil,
      profiles: Object.freeze(doc.profiles),
    })
  } catch {
    return null
  }
}
