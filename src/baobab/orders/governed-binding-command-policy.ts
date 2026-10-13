/**
 * LA-05C5 / P0-04B-02: validate canonical governed inputs before persistence.
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
/** RFC3339 plus actual calendar validity; Date.parse alone normalises Feb 30. */
export function parseBindingTimestamp(value: unknown): number {
  if (typeof value !== "string") return NaN
  const parts = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
    value,
  )
  if (!parts) return NaN
  const [, year, month, day] = parts.map(Number)
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())
    return NaN
  return Date.parse(value)
}
const requiredScope = (operation: "propose" | "approve" | "revoke") => `trade-binding:${operation}`
function assertActor(
  actor: GovernedActor,
  scope: GovernedBindingScope,
  operation: "propose" | "approve" | "revoke",
): void {
  if (
    !actor ||
    !valid(actor.subject) ||
    actor.audience !== "baobab-control-plane" ||
    actor.tenantId !== scope.tenantId ||
    actor.organisationId !== scope.organisationId ||
    !Array.isArray(actor.scopes) ||
    !actor.scopes.every((scope) => typeof scope === "string") ||
    !actor.scopes.includes(requiredScope(operation))
  )
    deny()
}
function assertScope(scope: GovernedBindingScope): void {
  if (
    !scope ||
    ![
      "cartId",
      "tenantId",
      "organisationId",
      "responsibleLegalEntityId",
      "marketCode",
      "currencyCode",
      "salesChannelId",
      "regionId",
    ].every((key) => valid(scope[key as keyof GovernedBindingScope])) ||
    !/^[A-Z]{2}$/.test(scope.marketCode) ||
    !/^[A-Z]{3}$/.test(scope.currencyCode)
  )
    deny()
}
export function assertBindingProposal(proposal: BindingProposal, nowMs: number): void {
  if (!proposal || !Number.isFinite(nowMs)) deny()
  assertScope(proposal.scope)
  assertActor(proposal.maker, proposal.scope, "propose")
  const proposed = parseBindingTimestamp(proposal.proposedAt)
  const expiry = parseBindingTimestamp(proposal.expiresAt)
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
  const approved = parseBindingTimestamp(approval.approvedAt)
  if (
    approval.checker.subject === approval.proposal.maker.subject ||
    !valid(approval.approvalReference) ||
    !Number.isFinite(approved) ||
    approved < parseBindingTimestamp(approval.proposal.proposedAt) ||
    approved > nowMs ||
    approved >= parseBindingTimestamp(approval.proposal.expiresAt)
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
