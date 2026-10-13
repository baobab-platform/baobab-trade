import {
  assertBindingApproval,
  parseBindingTimestamp,
  assertBindingProposal,
  assertBindingRevocation,
  type BindingApproval,
  type BindingProposal,
  type GovernedActor,
  type GovernedBindingScope,
} from "./governed-binding-command-policy"

/**
 * LA-05C5 boundary: caller-supplied claims or evidence references are NEVER
 * sufficient. Every adapter must fail closed when its authority is unavailable.
 * Storage must commit binding transition AND outbox record atomically.
 */
export type VerifiedActor = GovernedActor & { issuer: string; tokenId: string }
export type VerifiedEvidence = {
  reference: string
  decisionId: string
  verifiedAt: string
  expectedRevision?: number
  admission?: import("./binding-authority-client").BindingAdmission
}
export interface BindingAuthorityPorts {
  iam: {
    verify(token: string, operation: "propose" | "approve" | "revoke"): Promise<VerifiedActor>
  }
  evidence: {
    verify(reference: string, scope: GovernedBindingScope): Promise<VerifiedEvidence>
  }
  legalAuthority: {
    assertCurrent(scope: GovernedBindingScope): Promise<void>
  }
  persistence: {
    propose(command: BindingProposal, evidence: VerifiedEvidence): Promise<void>
    approve(command: BindingApproval, evidence: VerifiedEvidence): Promise<void>
    revoke(
      scope: GovernedBindingScope,
      actor: VerifiedActor,
      reason: string,
      evidence: VerifiedEvidence,
    ): Promise<void>
  }
}
const requireVerified = (actor: VerifiedActor): void => {
  if (!actor?.issuer?.trim() || !actor?.tokenId?.trim()) {
    throw new Error("LA-05C5 denied: verified IAM identity required")
  }
}
const requireEvidence = (evidence: VerifiedEvidence, reference: string, at: number): void => {
  if (
    !evidence ||
    evidence.reference !== reference ||
    !evidence.decisionId?.trim() ||
    !Number.isFinite(parseBindingTimestamp(evidence.verifiedAt)) ||
    parseBindingTimestamp(evidence.verifiedAt) > at ||
    at - parseBindingTimestamp(evidence.verifiedAt) > 30_000
  ) {
    throw new Error("LA-05C5 denied: canonical evidence verification failed")
  }
}
async function reverifyActor(
  ports: BindingAuthorityPorts,
  token: string,
  operation: "propose" | "approve" | "revoke",
  original: VerifiedActor,
): Promise<VerifiedActor> {
  const current = await ports.iam.verify(token, operation)
  requireVerified(current)
  if (
    ["subject", "issuer", "tokenId", "tenantId", "organisationId", "audience"].some(
      (key) => current[key as keyof VerifiedActor] !== original[key as keyof VerifiedActor],
    ) ||
    !Array.isArray(current.scopes) ||
    !current.scopes.every((scope) => typeof scope === "string") ||
    !current.scopes.includes(`trade-binding:${operation}`)
  ) {
    throw new Error("LA-05C5 denied: IAM identity or command authority changed")
  }
  return current
}
export async function proposeBinding(
  ports: BindingAuthorityPorts,
  token: string,
  proposal: BindingProposal,
  now: () => number = Date.now,
): Promise<void> {
  const actor = await ports.iam.verify(token, "propose")
  requireVerified(actor)
  // Never trust the maker supplied in a request; bind to the verified principal.
  if (actor.subject !== proposal.maker.subject) throw new Error("LA-05C5 denied: maker mismatch")
  const canonical = { ...proposal, maker: actor }
  assertBindingProposal(canonical, now())
  await ports.legalAuthority.assertCurrent(canonical.scope)
  const evidence = await ports.evidence.verify(canonical.evidenceReference, canonical.scope)
  requireEvidence(evidence, canonical.evidenceReference, now())
  // Remote evidence verification may outlive a human session, proposal or CP
  // attestation. Recheck the actual principal/scope and authority after that I/O.
  await reverifyActor(ports, token, "propose", actor)
  await ports.legalAuthority.assertCurrent(canonical.scope)
  assertBindingProposal(canonical, now())
  requireEvidence(evidence, canonical.evidenceReference, now())
  await ports.persistence.propose(canonical, evidence)
}
export async function approveBinding(
  ports: BindingAuthorityPorts,
  token: string,
  approval: BindingApproval,
  now: () => number = Date.now,
): Promise<void> {
  const actor = await ports.iam.verify(token, "approve")
  requireVerified(actor)
  if (actor.subject !== approval.checker.subject)
    throw new Error("LA-05C5 denied: checker mismatch")
  const canonical = { ...approval, checker: actor }
  assertBindingApproval(canonical, now())
  await ports.legalAuthority.assertCurrent(canonical.proposal.scope)
  const evidence = await ports.evidence.verify(
    canonical.approvalReference,
    canonical.proposal.scope,
  )
  requireEvidence(evidence, canonical.approvalReference, now())
  await reverifyActor(ports, token, "approve", actor)
  await ports.legalAuthority.assertCurrent(canonical.proposal.scope)
  assertBindingApproval(canonical, now())
  requireEvidence(evidence, canonical.approvalReference, now())
  await ports.persistence.approve(canonical, evidence)
}
export async function revokeBinding(
  ports: BindingAuthorityPorts,
  token: string,
  scope: GovernedBindingScope,
  reason: string,
  reference: string,
  now: () => number = Date.now,
): Promise<void> {
  const actor = await ports.iam.verify(token, "revoke")
  requireVerified(actor)
  assertBindingRevocation(scope, actor, reason, reference)
  const evidence = await ports.evidence.verify(reference, scope)
  requireEvidence(evidence, reference, now())
  // Revocation never requires a still-valid legal mandate: withdrawing a local
  // binding must remain possible after CP has revoked the original mandate.
  const current = await reverifyActor(ports, token, "revoke", actor)
  assertBindingRevocation(scope, current, reason, reference)
  requireEvidence(evidence, reference, now())
  await ports.persistence.revoke(scope, actor, reason, evidence)
}
