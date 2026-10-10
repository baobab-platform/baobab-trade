/**
 * LA-05C5 candidate: validate governed command inputs before any persistence.
 * This is NOT an issuance API, IAM verifier, CP legal-actor grant, or PSP certification.
 * Callers must authenticate the actor and verify its audience/scopes independently.
 */
export type GovernedBindingScope = {
  cartId: string
  tenantId: string
  organisationId: string
  responsibleLegalEntityId: string
  marketCode: string
  currencyCode: string
  salesChannelId: string
  regionId: string
}
export type GovernedActor = {
  subject: string
  tenantId: string
  organisationId: string
  audience: string
  scopes: readonly string[]
}
export type BindingProposal = {
  scope: GovernedBindingScope
  maker: GovernedActor
  proposedAt: string
  expiresAt: string
  evidenceReference: string
}
export type BindingApproval = {
  proposal: BindingProposal
  checker: GovernedActor
  approvedAt: string
  approvalReference: string
}
const valid = (value: string): boolean => typeof value === "string" && value.trim().length > 0
const deny = (): never => {
  throw new Error("LA-05C5 denied: governed binding command is not authorised")
}
const parseTime = (value: string): number => Date.parse(value)
const requiredScope = (operation: "propose" | "approve" | "revoke") =>
  `trade:legal-seller-binding:${operation}`
function assertActor(
  actor: GovernedActor,
  scope: GovernedBindingScope,
  operation: "propose" | "approve" | "revoke",
): void {
  if (
    !actor ||
    !valid(actor.subject) ||
    actor.audience !== "baobab-trade" ||
    actor.tenantId !== scope.tenantId ||
    actor.organisationId !== scope.organisationId ||
    !actor.scopes?.includes(requiredScope(operation))
  )
    deny()
}
function assertScope(scope: GovernedBindingScope): void {
  if (
    !scope ||
    !Object.values(scope).every(valid) ||
    !/^[A-Z]{2}$/.test(scope.marketCode) ||
    !/^[A-Z]{3}$/.test(scope.currencyCode)
  )
    deny()
}
export function assertBindingProposal(proposal: BindingProposal, nowMs: number): void {
  if (!proposal || !Number.isFinite(nowMs)) deny()
  assertScope(proposal.scope)
  assertActor(proposal.maker, proposal.scope, "propose")
  const proposed = parseTime(proposal.proposedAt)
  const expiry = parseTime(proposal.expiresAt)
  if (
    !valid(proposal.evidenceReference) ||
    !Number.isFinite(proposed) ||
    !Number.isFinite(expiry) ||
    proposed > nowMs ||
    expiry <= nowMs ||
    expiry <= proposed
  )
    deny()
}
export function assertBindingApproval(approval: BindingApproval, nowMs: number): void {
  if (!approval) deny()
  assertBindingProposal(approval.proposal, nowMs)
  assertActor(approval.checker, approval.proposal.scope, "approve")
  const approved = parseTime(approval.approvedAt)
  if (
    approval.checker.subject === approval.proposal.maker.subject ||
    !valid(approval.approvalReference) ||
    !Number.isFinite(approved) ||
    approved < parseTime(approval.proposal.proposedAt) ||
    approved > nowMs ||
    approved >= parseTime(approval.proposal.expiresAt)
  )
    deny()
}
export function assertBindingRevocation(
  scope: GovernedBindingScope,
  actor: GovernedActor,
  reason: string,
  evidenceReference: string,
): void {
  assertScope(scope)
  assertActor(actor, scope, "revoke")
  if (!valid(reason) || !valid(evidenceReference)) deny()
}
