/**
 * ADR-0023 federated supplier readiness gate. Trade never creates the
 * canonical Organisation or an iDempiere Business Partner from local state.
 * The caller must obtain current CP, Trade, ERP, Compliance and IAM receipts
 * from their respective authenticated owners, not from supplier portal input.
 */
export type SupplierProcurementScope = {
  tenantId: string
  buyerLegalEntityId: string
  marketId: string
  canonicalSupplierOrganisationId: string
  productId: string
}
export type OwnerAttestation = SupplierProcurementScope & {
  authority: "CP" | "TRADE" | "ERP" | "COMPLIANCE" | "IAM"
  status: string
  reference: string
  version: string
  observedAt: string
  validUntil: string
}
export type SupplierQualificationReceipt = SupplierProcurementScope & {
  qualificationType: string
  status: "PASSED" | "PASSED_WITH_CONDITIONS" | "WAIVED" | "FAILED" | "EXPIRED" | "PENDING"
  approvalReference: string
  decidedBy: string
  submittedBy: string
  evidenceReference: string
  effectiveFrom: string
  expiresAt: string
}
export type SupplierReadinessEvidence = {
  cpIdentity: OwnerAttestation
  tradeRelationship: OwnerAttestation
  erpVendor: OwnerAttestation
  compliance: OwnerAttestation
  iamPortal?: OwnerAttestation
  qualificationReceipts: readonly SupplierQualificationReceipt[]
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
export class SupplierNotReady extends Error {
  constructor(readonly reason: string) {
    super("ADR-0023 supplier not ready: " + reason)
  }
}
const deny = (s: string): never => {
  throw new SupplierNotReady(s)
}
const ident = (s: unknown, name: string) => {
  if (typeof s !== "string" || !ID.test(s)) deny("missing " + name)
}
const time = (s: string) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s))
    return deny("invalid UTC effective interval")
  const t = Date.parse(s)
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 19) !== s.slice(0, 19))
    return deny("invalid UTC effective interval")
  return t
}
const scopeFields = [
  "tenantId", "buyerLegalEntityId", "marketId", "canonicalSupplierOrganisationId", "productId",
] as const
function scope(expected: SupplierProcurementScope, incoming: SupplierProcurementScope): void {
  for (const key of scopeFields) {
    ident(expected[key], key)
    ident(incoming[key], key)
    if (expected[key] !== incoming[key]) deny("foreign supplier evidence: " + key)
  }
}
function currentWindow(from: string, to: string, at: number): void {
  const start = time(from)
  const end = time(to)
  if (start > at || at >= end || start >= end) deny("expired or future-dated supplier evidence")
}
function receipt(
  expected: SupplierProcurementScope,
  attestation: OwnerAttestation,
  authority: OwnerAttestation["authority"],
  expectedStatus: string,
  at: number,
): void {
  scope(expected, attestation)
  if (attestation.authority !== authority || attestation.status !== expectedStatus)
    deny(authority + " does not attest required supplier readiness")
  ident(attestation.reference, authority + " reference")
  ident(attestation.version, authority + " version")
  currentWindow(attestation.observedAt, attestation.validUntil, at)
}

/** No registration, corporate ownership or trade approval implies ERP activation. */
export function assertSupplierProcurementReadiness(
  expected: SupplierProcurementScope,
  evidence: SupplierReadinessEvidence,
  requiredQualificationTypes: readonly string[],
  now: string,
  requirePortalIdentity = false,
): { canonicalSupplierOrganisationId: string; qualificationReferences: string[] } {
  const at = time(now)
  receipt(expected, evidence.cpIdentity, "CP", "VERIFIED_SUPPLIER_ROLE", at)
  receipt(expected, evidence.tradeRelationship, "TRADE", "ACTIVE", at)
  receipt(expected, evidence.erpVendor, "ERP", "VENDOR_READY", at)
  receipt(expected, evidence.compliance, "COMPLIANCE", "PASS", at)
  if (requirePortalIdentity) {
    if (!evidence.iamPortal) deny("supplier portal IAM evidence missing")
    receipt(expected, evidence.iamPortal, "IAM", "ACTIVE", at)
  }
  if (!Array.isArray(requiredQualificationTypes) || requiredQualificationTypes.length === 0)
    deny("required qualification policy missing")
  if (!Array.isArray(evidence.qualificationReceipts)) deny("qualification evidence missing")
  const unique = new Set<string>()
  const references: string[] = []
  for (const type of requiredQualificationTypes) {
    ident(type, "qualification type")
    if (unique.has(type)) deny("duplicate required supplier qualification")
    unique.add(type)
    const matches = evidence.qualificationReceipts.filter((q) => q.qualificationType === type)
    if (matches.length !== 1) deny("qualification missing or ambiguous: " + type)
    const q = matches[0]
    scope(expected, q)
    if (q.status !== "PASSED") deny("supplier qualification not passed: " + type)
    for (const field of ["approvalReference", "decidedBy", "submittedBy", "evidenceReference"] as const)
      ident(q[field], field)
    if (q.decidedBy === q.submittedBy) deny("supplier self-approval forbidden")
    currentWindow(q.effectiveFrom, q.expiresAt, at)
    references.push(q.approvalReference)
  }
  if (new Set(references).size !== references.length)
    deny("reused supplier qualification approval")
  return { canonicalSupplierOrganisationId: expected.canonicalSupplierOrganisationId,
    qualificationReferences: references }
}
