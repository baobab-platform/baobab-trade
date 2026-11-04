import type { AuthorizedCommitment, BuyerReceipt } from "./native-buyer-commitment"

/**
 * A fresh consequential readback from the real IAM issuer, Control Plane
 * Principal/mandate/Market and Trade buyer operation decision. The runtime
 * transport that constructs this MUST re-read independent authorities with
 * issuer/audience verification; a cached discovery token is never enough.
 *
 * No individual boolean can grant permission by itself. This closed record
 * binds the readback to the exact already-authorised purchase and seller
 * mandate. Tested mocks prove refusal logic, not issuer/CP connectivity.
 */
export type NativeCommitAuthorityReadback = {
  outcome: "ALLOW" | "DENY" | "UNAVAILABLE"
  actorStatus: "ACTIVE" | "INACTIVE"
  membershipStatus: "ACTIVE" | "INACTIVE"
  sellerMandateStatus: "ACTIVE" | "REVOKED"
  tenantId: string
  principalId: string
  canonicalOrganisationId: string
  buyerOrganisationId: string
  membershipId: string
  membershipRevision: number
  marketId: string
  operation: BuyerReceipt["operation"]
  resourceId: string
  resourceVersion: number
  transactionDigest: string
  amountMinor: number
  currency: string
  spendReservationId: string
  spendHoldRevision: number
  sellerBindingId: string
  sellerBindingVersion: number
  sellerMandateId: string
  sellerLegalEntityId: string
  checkedAt: string
  expiresAt: string
  /** Independent read-only IAM/CP and Trade evidence, never a client assertion. */
  evidenceReferences: readonly string[]
}

/**
 * CAA-06b commitment guard. The buyer spend row has already been locked in
 * the owner's PostgreSQL transaction. Any denial must THROW, so the native
 * order, seller receipt, ledger, buyer receipt and outbox are rolled back.
 */
export function requireCurrentNativeCommitAuthority(
  original: AuthorizedCommitment,
  actual: NativeCommitAuthorityReadback,
  now: number,
): void {
  const b = original.receipt
  const s = original.seller
  const times = [Date.parse(actual?.checkedAt), Date.parse(actual?.expiresAt)]
  if (
    !actual ||
    actual.outcome !== "ALLOW" ||
    actual.actorStatus !== "ACTIVE" ||
    actual.membershipStatus !== "ACTIVE" ||
    actual.sellerMandateStatus !== "ACTIVE" ||
    !Number.isFinite(now) ||
    !times.every(Number.isFinite) ||
    times[0] > now ||
    now >= times[1] ||
    times[1] - times[0] > 30_000 ||
    actual.tenantId !== b.tenant_id ||
    actual.principalId !== b.actor_principal_id ||
    actual.canonicalOrganisationId !== b.canonical_organisation_id ||
    actual.buyerOrganisationId !== b.buyer_organisation_id ||
    actual.membershipId !== b.buyer_membership_id ||
    actual.membershipRevision !== b.membership_revision ||
    actual.marketId !== b.market_id ||
    actual.operation !== b.operation ||
    actual.resourceId !== b.resource_id ||
    actual.resourceVersion !== b.resource_version ||
    actual.transactionDigest !== b.transaction_digest ||
    actual.amountMinor !== b.amount_minor ||
    actual.currency !== b.currency ||
    actual.spendReservationId !== b.spend_reservation_id ||
    actual.spendHoldRevision !== b.spend_hold_revision ||
    actual.sellerBindingId !== s.binding_id ||
    actual.sellerBindingVersion !== s.binding_version ||
    actual.sellerMandateId !== s.mandate_id ||
    actual.sellerLegalEntityId !== s.responsible_legal_entity_id ||
    !Array.isArray(actual.evidenceReferences) ||
    actual.evidenceReferences.length < 2 ||
    actual.evidenceReferences.length > 20 ||
    actual.evidenceReferences.some(
      (reference) =>
        typeof reference !== "string" ||
        reference.length < 8 ||
        reference.length > 256 ||
        reference.startsWith("synthetic:"),
    )
  ) {
    throw new Error("CURRENT_NATIVE_COMMIT_AUTHORITY_NOT_PROVEN")
  }
}
