import type { VerifiedBuyerToken } from "./buyer-access-token"

/**
 * ADR-SHARED-042 CAA-03 (Platform Owner ruling of 22 October 2026; Shared
 * identity/v1 assurance-policy.schema.json): what verified IAM authentication
 * evidence each buyer operation needs.
 *
 * Until the Shared policy and IAM's issuer-backed values are qualified, Trade
 * enforces the ruling's strict interim verifier:
 * - one trusted issuer;
 * - a security-approved, exact acr allowlist (BAOBAB_BUYER_ACCEPTED_ACR) with
 *   its approval reference;
 * - for the operations of the BUYER_SESSION profile only.
 *
 * There is no permissive default. Without the allowlist and its approval,
 * every buyer operation is OPERATION_NOT_ACTIVATED. BUYER_COMMITMENT and
 * BUYER_ADMINISTRATION operations stay OPERATION_NOT_ACTIVATED until a full
 * approved policy (required methods, freshness, step-up) is loaded. acr values
 * match exactly; no ordering between strings is assumed. Meeting assurance
 * never establishes permission to buy.
 */
export type AssuranceProfile = "BUYER_SESSION" | "BUYER_COMMITMENT" | "BUYER_ADMINISTRATION"

/** The canonical mapping, fixed by the pinned Shared contract version. */
export const CANONICAL_OPERATION_PROFILES = {
  "trade.buyer-context.resolve": "BUYER_SESSION",
  "trade.private-catalogue.view": "BUYER_SESSION",
  "trade.contract-price.view": "BUYER_SESSION",
  "trade.cart.modify": "BUYER_SESSION",
  "trade.rfq.submit": "BUYER_COMMITMENT",
  "trade.quotation.accept": "BUYER_COMMITMENT",
  "trade.purchase-approval.decide": "BUYER_COMMITMENT",
  "trade.order.commit": "BUYER_COMMITMENT",
  "trade.order.create": "BUYER_COMMITMENT",
  "trade.draft-order.finalize": "BUYER_COMMITMENT",
  "trade.buyer-invitation.accept": "BUYER_COMMITMENT",
  "trade.buyer-member.manage": "BUYER_ADMINISTRATION",
} as const satisfies Record<string, AssuranceProfile>

export type BuyerOperation = keyof typeof CANONICAL_OPERATION_PROFILES

export type InterimAssurancePolicy = {
  issuer: string
  acceptedSessionAcr: ReadonlySet<string>
  approvalReference: string
}

export type AssuranceOutcome =
  | { ok: true; policyRevision: string }
  | { ok: false; reason: "ASSURANCE_INSUFFICIENT" | "OPERATION_NOT_ACTIVATED" }

/** The policy revision a decision records (trade/v2 policy_revision). */
export const INTERIM_POLICY_REVISION = "buyer-assurance.interim-acr-allowlist:v1"

/**
 * Builds the interim policy from configuration, or null when it is
 * incomplete. Null is never a pass: evaluation then denies everything.
 */
export const interimAssurancePolicy = (config: {
  issuer?: string
  acceptedAcr: readonly string[]
  approvalReference?: string
}): InterimAssurancePolicy | null => {
  const values = config.acceptedAcr.map((value) => value.trim()).filter(Boolean)
  const approval = config.approvalReference?.trim()
  if (!config.issuer || values.length === 0 || !approval) return null
  if (values.some((value) => value === "*" || value.length > 255 || /\s/.test(value))) return null
  let issuer: string
  try {
    // OIDC issuer identifiers are exact trust identifiers. Validate the
    // transport like BuyerTokenVerifier, without URL.href rewriting a bare
    // origin with a trailing slash (Hydra's configured issuer is slashless).
    const url = new URL(config.issuer)
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      config.issuer.trim() !== config.issuer
    )
      return null
    issuer = config.issuer
  } catch {
    return null
  }
  return { issuer, acceptedSessionAcr: new Set(values), approvalReference: approval }
}

export const evaluateAssurance = (
  policy: InterimAssurancePolicy | null,
  operation: BuyerOperation,
  token: Pick<VerifiedBuyerToken, "issuer" | "acr">,
): AssuranceOutcome => {
  if (!policy) return { ok: false, reason: "OPERATION_NOT_ACTIVATED" }
  if (CANONICAL_OPERATION_PROFILES[operation] !== "BUYER_SESSION") {
    return { ok: false, reason: "OPERATION_NOT_ACTIVATED" }
  }
  if (token.issuer !== policy.issuer || !token.acr || !policy.acceptedSessionAcr.has(token.acr)) {
    return { ok: false, reason: "ASSURANCE_INSUFFICIENT" }
  }
  return { ok: true, policyRevision: INTERIM_POLICY_REVISION }
}
