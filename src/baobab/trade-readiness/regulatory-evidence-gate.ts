/**
 * ADR-0021: internal regulatory execution gate. This does not decide any
 * law, classify a product, or authenticate a regulatory provider.
 *
 * The caller must bind provider results to current CP-authorised workload,
 * tenant, seller and trade lane BEFORE passing trusted evidence here.
 */
export type RegulatoryCheck =
  | "PRODUCT_CLASSIFICATION"
  | "RESTRICTED_PARTY"
  | "EXPORT_ELIGIBILITY"
  | "IMPORT_ELIGIBILITY"
  | "LICENSING"
  | "ORIGIN"
  | "CUSTOMS_VALUATION"
  | "DOCUMENTARY_REQUIREMENTS"

export type RegulatoryContext = {
  tenantId: string
  transactionReference: string
  sellerLegalEntityId: string
  buyerOrganisationId: string
  originCountry: string
  destinationCountry: string
  marketId: string
  productId: string
}

export type RegulatoryEvidence = RegulatoryContext & {
  check: RegulatoryCheck
  status: "PASS" | "PASS_WITH_CONDITIONS" | "REVIEW_REQUIRED" | "BLOCKED" | "EXPIRED" | "ERROR"
  providerId: string
  bindingReference: string
  decisionReference: string
  evidenceReference: string
  ruleVersion: string
  decidedAt: string
  expiresAt: string
}

export class RegulatoryClearanceRefusal extends Error {
  constructor(readonly reason: string) {
    super("ADR-0021 clearance refused: " + reason)
  }
}
const refuse = (reason: string): never => {
  throw new RegulatoryClearanceRefusal(reason)
}
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const requiredText = (value: unknown, label: string) => {
  if (typeof value !== "string" || !IDENTIFIER.test(value))
    refuse("missing or invalid " + label)
}
const time = (value: string, label: string) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    return refuse("invalid " + label)
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) ||
      new Date(milliseconds).toISOString().slice(0, 19) !== value.slice(0, 19))
    return refuse("invalid " + label)
  return milliseconds
}
const contextFields = [
  "tenantId",
  "transactionReference",
  "sellerLegalEntityId",
  "buyerOrganisationId",
  "originCountry",
  "destinationCountry",
  "marketId",
  "productId",
] as const
const supported: readonly RegulatoryCheck[] = [
  "PRODUCT_CLASSIFICATION",
  "RESTRICTED_PARTY",
  "EXPORT_ELIGIBILITY",
  "IMPORT_ELIGIBILITY",
  "LICENSING",
  "ORIGIN",
  "CUSTOMS_VALUATION",
  "DOCUMENTARY_REQUIREMENTS",
]

/**
 * A complete required-check set must be explicitly provided by a trusted
 * regulatory requirements resolver. Empty/incomplete requirements must NOT
 * be used as an "approval" shortcut.
 *
 * Conditional PASS is held pending an independently qualified condition
 * evaluator. There is intentionally no allow-flag in client data.
 */
export function assertRegulatoryExecutionClearance(
  context: RegulatoryContext,
  required: readonly RegulatoryCheck[],
  evidence: readonly RegulatoryEvidence[],
  effectiveAt: string,
): { approvedChecks: RegulatoryCheck[]; decisionReferences: string[] } {
  const now = time(effectiveAt, "effective time")
  if (!Array.isArray(required) || required.length === 0 || !Array.isArray(evidence))
    refuse("no authoritative required-check set")
  for (const field of contextFields) requiredText(context[field], field)
  const unique = new Set<RegulatoryCheck>()
  for (const check of required) {
    if (!supported.includes(check) || unique.has(check)) refuse("invalid or duplicate required check")
    unique.add(check)
  }
  const byCheck = new Map<RegulatoryCheck, RegulatoryEvidence>()
  for (const result of evidence) {
    if (typeof result !== "object" || result === null || !supported.includes(result.check))
      refuse("unknown regulatory assessment")
    for (const field of contextFields) {
      requiredText(result[field], field)
      if (result[field] !== context[field]) refuse("foreign regulatory context: " + field)
    }
    for (const field of ["providerId", "bindingReference", "decisionReference", "evidenceReference", "ruleVersion"] as const)
      requiredText(result[field], field)
    if (byCheck.has(result.check)) refuse("duplicate regulatory decision")
    const decided = time(result.decidedAt, "decision time")
    const expires = time(result.expiresAt, "expiry")
    if (decided > now || now >= expires || decided >= expires)
      refuse("stale or future-dated regulatory decision")
    byCheck.set(result.check, result)
  }
  const decisionReferences: string[] = []
  const seenDecisionReferences = new Set<string>()
  for (const check of required) {
    const result = byCheck.get(check)
    if (!result) refuse("missing mandatory regulatory check: " + check)
    if (result.status !== "PASS") refuse("mandatory regulatory check not cleared: " + check)
    if (seenDecisionReferences.has(result.decisionReference))
      refuse("reused regulatory decision reference")
    seenDecisionReferences.add(result.decisionReference)
    decisionReferences.push(result.decisionReference)
  }
  return { approvedChecks: [...required], decisionReferences }
}
