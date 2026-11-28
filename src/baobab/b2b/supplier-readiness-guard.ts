/**
 * ADR-0023 federated supplier readiness gate. Trade never creates canonical
 * Organisation identity or an iDempiere Business Partner from local state.
 * Every owner receipt and qualification policy must come from its trusted
 * authority adapter; this kernel checks scope and consistency only.
 */
export type SupplierProcurementScope = Readonly<{
  tenantId: string
  buyerLegalEntityId: string
  supplierLegalEntityId: string
  marketId: string
  marketRevision: number
  canonicalSupplierOrganisationId: string
  productId: string
  supplierProductReference: string
  originCountry: string
  destinationCountry: string
  tradeLaneId?: string
}>

export type SupplierOwnerAuthority = "CP" | "TRADE" | "ERP" | "COMPLIANCE" | "IAM"
export type SupplierAttestationType =
  | "CANONICAL_SUPPLIER_ROLE"
  | "ACTIVE_TRADE_RELATIONSHIP"
  | "PRODUCT_CAPABILITY"
  | "MARKET_ELIGIBILITY"
  | "ERP_VENDOR_READY"
  | "COMPLIANCE_CLEARANCE"
  | "IAM_PORTAL_ACCESS"

export type OwnerAttestation = SupplierProcurementScope & Readonly<{
  authority: SupplierOwnerAuthority
  attestationType: SupplierAttestationType
  status: string
  reference: string
  version: string
  observedAt: string
  validUntil: string
}>

export type SupplierQualificationStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "UNDER_REVIEW"
  | "PASSED"
  | "PASSED_WITH_CONDITIONS"
  | "FAILED"
  | "EXPIRED"
  | "WAIVED"

export type SupplierQualificationReceipt = SupplierProcurementScope & Readonly<{
  qualificationType: string
  status: SupplierQualificationStatus
  approvalReference: string
  decidedBy: string
  deciderAuthority: "TRADE"
  deciderRole: "SUPPLIER_APPROVER" | "QUALITY_APPROVER" | "COMPLIANCE_APPROVER"
  submittedBy: string
  evidenceReference: string
  effectiveFrom: string
  expiresAt: string
}>

export type SupplierQualificationPolicy = SupplierProcurementScope & Readonly<{
  policyReference: string
  policyVersion: string
  requiredQualificationTypes: readonly string[]
}>

export type SupplierReadinessEvidence = Readonly<{
  cpIdentity: OwnerAttestation
  tradeRelationship: OwnerAttestation
  tradeProductCapability: OwnerAttestation
  tradeMarketEligibility: OwnerAttestation
  erpVendor: OwnerAttestation
  compliance: OwnerAttestation
  iamPortal?: OwnerAttestation
  qualificationReceipts: readonly SupplierQualificationReceipt[]
}>

export type SupplierReadinessSnapshot = Readonly<{
  canonicalSupplierOrganisationId: string
  scope: SupplierProcurementScope
  qualificationPolicyReference: string
  qualificationPolicyVersion: string
  ownerAttestations: readonly Readonly<{
    authority: SupplierOwnerAuthority
    attestationType: SupplierAttestationType
    reference: string
    version: string
    observedAt: string
    validUntil: string
  }>[]
  qualificationReferences: readonly Readonly<{
    qualificationType: string
    approvalReference: string
    evidenceReference: string
    effectiveFrom: string
    expiresAt: string
    decidedBy: string
    deciderRole: SupplierQualificationReceipt["deciderRole"]
  }>[]
  evaluatedAt: string
}>

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const COUNTRY = /^[A-Z]{2}$/
const ownerAttestationTypes: readonly SupplierAttestationType[] = [
  "CANONICAL_SUPPLIER_ROLE",
  "ACTIVE_TRADE_RELATIONSHIP",
  "PRODUCT_CAPABILITY",
  "MARKET_ELIGIBILITY",
  "ERP_VENDOR_READY",
  "COMPLIANCE_CLEARANCE",
  "IAM_PORTAL_ACCESS",
]
const qualificationStatuses: readonly SupplierQualificationStatus[] = [
  "NOT_STARTED",
  "PENDING",
  "UNDER_REVIEW",
  "PASSED",
  "PASSED_WITH_CONDITIONS",
  "FAILED",
  "EXPIRED",
  "WAIVED",
]
export class SupplierNotReady extends Error {
  constructor(readonly reason: string) {
    super("ADR-0023 supplier not ready: " + reason)
  }
}
const deny = (reason: string): never => {
  throw new SupplierNotReady(reason)
}
const ident = (value: unknown, name: string): void => {
  if (typeof value !== "string" || !ID.test(value)) deny("missing or invalid " + name)
}
const time = (value: unknown, name: string): number => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) return deny("invalid UTC " + name)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19))
    return deny("invalid UTC " + name)
  return parsed
}
const scopeFields: readonly (keyof SupplierProcurementScope)[] = [
  "tenantId",
  "buyerLegalEntityId",
  "supplierLegalEntityId",
  "marketId",
  "marketRevision",
  "canonicalSupplierOrganisationId",
  "productId",
  "supplierProductReference",
  "originCountry",
  "destinationCountry",
  "tradeLaneId",
]
const validateScope = (value: SupplierProcurementScope): void => {
  if (!value || typeof value !== "object") deny("supplier procurement scope missing")
  for (const field of [
    "tenantId",
    "buyerLegalEntityId",
    "supplierLegalEntityId",
    "marketId",
    "canonicalSupplierOrganisationId",
    "productId",
    "supplierProductReference",
  ] as const) ident(value[field], field)
  if (
    !Number.isSafeInteger(value.marketRevision) ||
    value.marketRevision < 1 ||
    !COUNTRY.test(value.originCountry) ||
    !COUNTRY.test(value.destinationCountry)
  ) deny("invalid supplier Market revision or origin/destination")
  if (value.tradeLaneId !== undefined) ident(value.tradeLaneId, "tradeLaneId")
  if (value.originCountry !== value.destinationCountry && !value.tradeLaneId)
    deny("cross-border supplier scope requires Trade Lane")
}
const scope = (expected: SupplierProcurementScope, incoming: SupplierProcurementScope): void => {
  validateScope(expected)
  validateScope(incoming)
  for (const key of scopeFields) {
    if (expected[key] !== incoming[key]) deny("foreign supplier evidence: " + key)
  }
}
const currentWindow = (from: string, until: string, at: number): void => {
  const start = time(from, "effective-from")
  const end = time(until, "valid-until")
  if (start > at || at >= end || start >= end)
    deny("expired or future-dated supplier evidence")
}
const receipt = (
  expected: SupplierProcurementScope,
  attestation: OwnerAttestation,
  authority: SupplierOwnerAuthority,
  type: SupplierAttestationType,
  status: string,
  at: number,
): void => {
  if (!attestation || typeof attestation !== "object") deny(authority + " attestation missing")
  scope(expected, attestation)
  if (
    attestation.authority !== authority ||
    attestation.attestationType !== type ||
    attestation.status !== status ||
    !ownerAttestationTypes.includes(attestation.attestationType)
  ) deny(authority + " does not attest required " + type)
  ident(attestation.reference, authority + " reference")
  ident(attestation.version, authority + " version")
  currentWindow(attestation.observedAt, attestation.validUntil, at)
}

/**
 * No registration, identity match, supplier role or ERP vendor projection
 * alone implies approval. This gate requires distinct current owner receipts,
 * product capability, market eligibility, scoped qualification and (when the
 * operation is a supplier-portal action) IAM portal access.
 */
export function assertSupplierProcurementReadiness(
  expected: SupplierProcurementScope,
  evidence: SupplierReadinessEvidence,
  qualificationPolicy: SupplierQualificationPolicy,
  now: string,
  requirePortalIdentity = false,
): SupplierReadinessSnapshot {
  const at = time(now, "readiness evaluation time")
  validateScope(expected)
  if (!evidence || typeof evidence !== "object") deny("supplier readiness evidence missing")
  if (!qualificationPolicy || typeof qualificationPolicy !== "object")
    deny("qualification policy missing")
  scope(expected, qualificationPolicy)
  ident(qualificationPolicy.policyReference, "qualification policy reference")
  ident(qualificationPolicy.policyVersion, "qualification policy version")
  const required = qualificationPolicy.requiredQualificationTypes
  if (!Array.isArray(required) || required.length === 0)
    deny("required qualification policy missing")
  const requiredTypes = new Set<string>()
  for (const type of required) {
    ident(type, "qualification type")
    if (requiredTypes.has(type)) deny("duplicate required supplier qualification")
    requiredTypes.add(type)
  }

  receipt(expected, evidence.cpIdentity, "CP", "CANONICAL_SUPPLIER_ROLE", "VERIFIED_SUPPLIER_ROLE", at)
  receipt(expected, evidence.tradeRelationship, "TRADE", "ACTIVE_TRADE_RELATIONSHIP", "ACTIVE", at)
  receipt(expected, evidence.tradeProductCapability, "TRADE", "PRODUCT_CAPABILITY", "CAPABLE", at)
  receipt(expected, evidence.tradeMarketEligibility, "TRADE", "MARKET_ELIGIBILITY", "ELIGIBLE", at)
  receipt(expected, evidence.erpVendor, "ERP", "ERP_VENDOR_READY", "VENDOR_READY", at)
  receipt(expected, evidence.compliance, "COMPLIANCE", "COMPLIANCE_CLEARANCE", "PASS", at)
  const owners = [
    evidence.cpIdentity,
    evidence.tradeRelationship,
    evidence.tradeProductCapability,
    evidence.tradeMarketEligibility,
    evidence.erpVendor,
    evidence.compliance,
  ]
  if (requirePortalIdentity) {
    if (!evidence.iamPortal) deny("supplier portal IAM evidence missing")
    receipt(expected, evidence.iamPortal, "IAM", "IAM_PORTAL_ACCESS", "ACTIVE", at)
    owners.push(evidence.iamPortal)
  }

  if (!Array.isArray(evidence.qualificationReceipts))
    deny("supplier qualification evidence missing")
  const approvals = new Set<string>()
  const evidenceReferences = new Set<string>()
  const qualificationSnapshots: SupplierReadinessSnapshot["qualificationReferences"][number][] = []
  for (const type of requiredTypes) {
    const matches = evidence.qualificationReceipts.filter((item) => item?.qualificationType === type)
    if (matches.length !== 1) deny("qualification missing or ambiguous: " + type)
    const item = matches[0]
    if (!qualificationStatuses.includes(item.status) || item.status !== "PASSED")
      deny("supplier qualification not passed: " + type)
    scope(expected, item)
    for (const field of ["approvalReference", "decidedBy", "submittedBy", "evidenceReference"] as const)
      ident(item[field], field)
    if (
      item.deciderAuthority !== "TRADE" ||
      !["SUPPLIER_APPROVER", "QUALITY_APPROVER", "COMPLIANCE_APPROVER"].includes(item.deciderRole) ||
      item.decidedBy === item.submittedBy
    ) deny("supplier qualification lacks independent authorised Trade approval")
    if (approvals.has(item.approvalReference) || evidenceReferences.has(item.evidenceReference))
      deny("reused supplier qualification approval or evidence")
    currentWindow(item.effectiveFrom, item.expiresAt, at)
    approvals.add(item.approvalReference)
    evidenceReferences.add(item.evidenceReference)
    qualificationSnapshots.push({
      qualificationType: item.qualificationType,
      approvalReference: item.approvalReference,
      evidenceReference: item.evidenceReference,
      effectiveFrom: item.effectiveFrom,
      expiresAt: item.expiresAt,
      decidedBy: item.decidedBy,
      deciderRole: item.deciderRole,
    })
  }
  return {
    canonicalSupplierOrganisationId: expected.canonicalSupplierOrganisationId,
    scope: structuredClone(expected),
    qualificationPolicyReference: qualificationPolicy.policyReference,
    qualificationPolicyVersion: qualificationPolicy.policyVersion,
    ownerAttestations: owners.map((item) => ({
      authority: item.authority,
      attestationType: item.attestationType,
      reference: item.reference,
      version: item.version,
      observedAt: item.observedAt,
      validUntil: item.validUntil,
    })),
    qualificationReferences: qualificationSnapshots,
    evaluatedAt: new Date(at).toISOString(),
  }
}
