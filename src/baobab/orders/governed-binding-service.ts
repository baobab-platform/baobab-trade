import {
  assertBindingApproval,
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
export type VerifiedEvidence = { reference: string; decisionId: string; verifiedAt: string }
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
const requireEvidence = (evidence: VerifiedEvidence, reference: string): void => {
  if (
    !evidence ||
    evidence.reference !== reference ||
    !evidence.decisionId?.trim() ||
    !Number.isFinite(Date.parse(evidence.verifiedAt))
  ) {
    throw new Error("LA-05C5 denied: canonical evidence verification failed")
  }
}
export async function proposeBinding(
  ports: BindingAuthorityPorts,
  token: string,
  proposal: BindingProposal,
  nowMs: number,
): Promise<void> {
  const actor = await ports.iam.verify(token, "propose")
  requireVerified(actor)
  // Never trust the maker supplied in a request; bind to the verified principal.
  if (actor.subject !== proposal.maker.subject) throw new Error("LA-05C5 denied: maker mismatch")
  const canonical = { ...proposal, maker: actor }
  assertBindingProposal(canonical, nowMs)
  await ports.legalAuthority.assertCurrent(canonical.scope)
  const evidence = await ports.evidence.verify(canonical.evidenceReference, canonical.scope)
  requireEvidence(evidence, canonical.evidenceReference)
  await ports.persistence.propose(canonical, evidence)
}
export async function approveBinding(
  ports: BindingAuthorityPorts,
  token: string,
  approval: BindingApproval,
  nowMs: number,
): Promise<void> {
  const actor = await ports.iam.verify(token, "approve")
  requireVerified(actor)
  if (actor.subject !== approval.checker.subject)
    throw new Error("LA-05C5 denied: checker mismatch")
  const canonical = { ...approval, checker: actor }
  assertBindingApproval(canonical, nowMs)
  await ports.legalAuthority.assertCurrent(canonical.proposal.scope)
  const evidence = await ports.evidence.verify(
    canonical.approvalReference,
    canonical.proposal.scope,
  )
  requireEvidence(evidence, canonical.approvalReference)
  await ports.persistence.approve(canonical, evidence)
}
export async function revokeBinding(
  ports: BindingAuthorityPorts,
  token: string,
  scope: GovernedBindingScope,
  reason: string,
  reference: string,
): Promise<void> {
  const actor = await ports.iam.verify(token, "revoke")
  requireVerified(actor)
  assertBindingRevocation(scope, actor, reason, reference)
  const evidence = await ports.evidence.verify(reference, scope)
  requireEvidence(evidence, reference)
  await ports.persistence.revoke(scope, actor, reason, evidence)
}
