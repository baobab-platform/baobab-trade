import { describe, expect, it } from "vitest"
import type { AuthorizedCommitment } from "../src/baobab/b2b/native-buyer-commitment"
import {
  requireCurrentNativeCommitAuthority,
  type NativeCommitAuthorityReadback,
} from "../src/baobab/b2b/native-commit-authority-readback"

/** Pure refusal contract only. This fixture does not simulate issuer/CP success. */
const NOW = Date.parse("2026-11-04T19:00:15.000Z")
const original = {
  receipt: {
    tenant_id: "tn_testonly01",
    actor_principal_id: "principal_01",
    canonical_organisation_id: "organisation_01",
    buyer_organisation_id: "b2borg_test01",
    buyer_membership_id: "b2bmem_test01",
    membership_revision: 3,
    market_id: "market_ug01",
    operation: "trade.order.commit",
    resource_id: "cart_01",
    resource_version: 7,
    transaction_digest: "sha256:" + "a".repeat(64),
    amount_minor: 12345,
    currency: "UGX",
    spend_reservation_id: "b2bres_testonly1234",
    spend_hold_revision: 2,
  },
  seller: {
    binding_id: "f3c0e94d-47a5-4f80-8bc6-965ca3f5e3ab",
    binding_version: 2,
    mandate_id: "9dba8f7d-3a11-4ee2-924f-b37a84bf7151",
    responsible_legal_entity_id: "SELLER-UG",
  },
} as AuthorizedCommitment

const approved = (): NativeCommitAuthorityReadback => ({
  outcome: "ALLOW",
  actorStatus: "ACTIVE",
  membershipStatus: "ACTIVE",
  sellerMandateStatus: "ACTIVE",
  tenantId: original.receipt.tenant_id,
  principalId: original.receipt.actor_principal_id,
  canonicalOrganisationId: original.receipt.canonical_organisation_id,
  buyerOrganisationId: original.receipt.buyer_organisation_id,
  membershipId: original.receipt.buyer_membership_id,
  membershipRevision: original.receipt.membership_revision,
  marketId: original.receipt.market_id,
  operation: original.receipt.operation,
  resourceId: original.receipt.resource_id,
  resourceVersion: original.receipt.resource_version,
  transactionDigest: original.receipt.transaction_digest,
  amountMinor: original.receipt.amount_minor,
  currency: original.receipt.currency,
  spendReservationId: original.receipt.spend_reservation_id,
  spendHoldRevision: original.receipt.spend_hold_revision,
  sellerBindingId: original.seller.binding_id,
  sellerBindingVersion: original.seller.binding_version,
  sellerMandateId: original.seller.mandate_id,
  sellerLegalEntityId: original.seller.responsible_legal_entity_id,
  checkedAt: new Date(NOW - 1000).toISOString(),
  expiresAt: new Date(NOW + 5000).toISOString(),
  evidenceReferences: ["iam:issuer-native-check", "cp:mandate-native-check"],
})

describe("CAA-06b native owner IAM/CP revalidation gate (synthetic unit inputs)", () => {
  it("requires the precise purchase and seller mandate under a current bounded lease", () => {
    expect(() => requireCurrentNativeCommitAuthority(original, approved(), NOW)).not.toThrow()
  })

  it.each([
    ["issuer revoked principal", { actorStatus: "INACTIVE" }],
    ["issuer decision denial", { outcome: "DENY" }],
    ["issuer unavailable", { outcome: "UNAVAILABLE" }],
    ["buyer membership suspended", { membershipStatus: "INACTIVE" }],
    ["seller mandate revoked", { sellerMandateStatus: "REVOKED" }],
    ["foreign tenant", { tenantId: "tn_other01" }],
    ["foreign buyer", { buyerOrganisationId: "b2borg_other01" }],
    ["superseded membership", { membershipRevision: 4 }],
    ["foreign Market", { marketId: "market_za01" }],
    ["wrong operation", { operation: "trade.order.create" }],
    ["changed resource version", { resourceVersion: 8 }],
    ["price changed", { amountMinor: 12346 }],
    ["changed transaction", { transactionDigest: "sha256:" + "b".repeat(64) }],
    ["hold revised", { spendHoldRevision: 3 }],
    ["foreign seller", { sellerLegalEntityId: "SELLER-ZA" }],
    ["replaced binding", { sellerBindingVersion: 3 }],
    ["revoked mandate ID", { sellerMandateId: "mandate_revoked" }],
    ["stale readback", { expiresAt: new Date(NOW).toISOString() }],
    ["overlong lease", { expiresAt: new Date(NOW + 60_000).toISOString() }],
    ["synthetic evidence", { evidenceReferences: ["synthetic:iam", "synthetic:cp"] }],
  ] as const)("%s refuses even when the initial buyer decision was ALLOW", (_name, change) => {
    expect(() =>
      requireCurrentNativeCommitAuthority(original, { ...approved(), ...change }, NOW),
    ).toThrow("CURRENT_NATIVE_COMMIT_AUTHORITY_NOT_PROVEN")
  })
})
