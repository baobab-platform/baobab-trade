/**
 * ADR-0025 mandatory-document gate. It validates canonical metadata,
 * provenance, verification and business scope; it does not retrieve bytes,
 * verify signatures or authenticate the custody provider.
 */
export type DocumentBusinessScope = Readonly<{
  tenantId: string
  legalEntityId: string
  legalEntityRole: "BUYER" | "SELLER" | "SUPPLIER" | "CARRIER" | "ISSUER" | "RECIPIENT"
  transactionId: string
  marketId: string
  marketRevision: number
  shipmentId?: string
  tradeLaneId?: string
  productId?: string
}>

export type DocumentSourceSystem =
  | "TRADE"
  | "ERP"
  | "REGULATORY_PROVIDER"
  | "LOGISTICS_PROVIDER"
  | "EXTERNAL_ISSUER"

export type DocumentIssuerAuthority =
  | "TRADE"
  | "ERP"
  | "CUSTOMS_PROVIDER"
  | "LOGISTICS_PROVIDER"
  | "SUPPLIER"
  | "BUYER"
  | "REGULATORY_AUTHORITY"
  | "BANK"
  | "INSURER"
  | "OTHER_PROVIDER"

export type RequiredDocument = Readonly<{
  documentType: string
  mandatory: true
  acceptedIssuerSystems: readonly DocumentSourceSystem[]
  acceptedIssuerAuthorities: readonly DocumentIssuerAuthority[]
  acceptedIssuerReferences?: readonly string[]
}>

export type DocumentRequirementPolicy = DocumentBusinessScope & Readonly<{
  policyReference: string
  policyVersion: string
  effectiveFrom: string
  validUntil: string
  requirements: readonly RequiredDocument[]
}>

export type TradeDocumentEvidence = DocumentBusinessScope & Readonly<{
  canonicalDocumentId: string
  sourceSystem: DocumentSourceSystem
  sourceDocumentId: string
  documentType: string
  version: number
  contentReference: string
  contentSha256: string
  custodyVerificationReference: string
  issuerAuthority: DocumentIssuerAuthority
  issuerReference: string
  issuedAt: string
  validFrom?: string
  validUntil?: string | null
  status: "ISSUED" | "PENDING" | "REVOKED" | "SUPERSEDED" | "EXPIRED"
  verificationState: "VERIFIED" | "PENDING" | "UNVERIFIED" | "REJECTED" | "REVOKED" | "EXPIRED" | "DISPUTED"
}>

export type AcceptedDocumentEvidence = Readonly<{
  canonicalDocumentId: string
  sourceDocumentId: string
  documentType: string
  version: number
  sourceSystem: DocumentSourceSystem
  issuerAuthority: DocumentIssuerAuthority
  issuerReference: string
  contentReference: string
  contentSha256: string
  custodyVerificationReference: string
}>

export type DocumentReadiness = Readonly<{
  scope: DocumentBusinessScope
  requirementPolicyReference: string
  requirementPolicyVersion: string
  acceptedDocuments: readonly AcceptedDocumentEvidence[]
  evaluatedAt: string
}>

export class DocumentEvidenceRefusal extends Error {
  constructor(readonly reason: string) {
    super("ADR-0025 document evidence refused: " + reason)
  }
}
const deny = (reason: string): never => {
  throw new DocumentEvidenceRefusal(reason)
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const sourceSystems: readonly DocumentSourceSystem[] = [
  "TRADE",
  "ERP",
  "REGULATORY_PROVIDER",
  "LOGISTICS_PROVIDER",
  "EXTERNAL_ISSUER",
]
const issuerAuthorities: readonly DocumentIssuerAuthority[] = [
  "TRADE",
  "ERP",
  "CUSTOMS_PROVIDER",
  "LOGISTICS_PROVIDER",
  "SUPPLIER",
  "BUYER",
  "REGULATORY_AUTHORITY",
  "BANK",
  "INSURER",
  "OTHER_PROVIDER",
]
const scopeFields: readonly (keyof DocumentBusinessScope)[] = [
  "tenantId",
  "legalEntityId",
  "legalEntityRole",
  "transactionId",
  "marketId",
  "marketRevision",
  "shipmentId",
  "tradeLaneId",
  "productId",
]
const ref = (value: unknown, name: string): void => {
  if (typeof value !== "string" || !ID.test(value)) deny("invalid " + name)
}
const utc = (value: unknown, name: string): number => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) return deny("invalid UTC " + name)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19))
    return deny("invalid UTC " + name)
  return parsed
}
const validateScope = (scope: DocumentBusinessScope): void => {
  if (!scope || typeof scope !== "object") deny("document business scope missing")
  for (const field of ["tenantId", "legalEntityId", "transactionId", "marketId"] as const)
    ref(scope[field], field)
  if (
    !["BUYER", "SELLER", "SUPPLIER", "CARRIER", "ISSUER", "RECIPIENT"].includes(scope.legalEntityRole) ||
    !Number.isSafeInteger(scope.marketRevision) ||
    scope.marketRevision < 1
  ) deny("invalid legal-entity role or Market revision")
  for (const field of ["shipmentId", "tradeLaneId", "productId"] as const)
    if (scope[field] !== undefined) ref(scope[field], field)
}
const sameScope = (expected: DocumentBusinessScope, incoming: DocumentBusinessScope): boolean =>
  scopeFields.every((field) => expected[field] === incoming[field])
const currentWindow = (document: TradeDocumentEvidence, now: number): void => {
  const issued = utc(document.issuedAt, "document issue time")
  const validFrom = document.validFrom === undefined
    ? issued
    : utc(document.validFrom, "document valid-from")
  const validUntil = document.validUntil == null
    ? undefined
    : utc(document.validUntil, "document valid-until")
  if (
    issued > now ||
    validFrom > now ||
    (validUntil !== undefined && now >= validUntil) ||
    (validUntil !== undefined && validFrom >= validUntil)
  ) deny("document is not currently effective")
}

/**
 * The caller must obtain this versioned requirement policy from the
 * authoritative Trade/CP policy owner. The gate verifies exact coverage,
 * issuer constraints, business scope, custody reference and current status.
 */
export function assertDocumentPackageRelease(
  scope: DocumentBusinessScope,
  policy: DocumentRequirementPolicy,
  documents: readonly TradeDocumentEvidence[],
  now: string,
): DocumentReadiness {
  const at = utc(now, "evaluation time")
  validateScope(scope)
  if (!policy || typeof policy !== "object") deny("document requirement policy missing")
  validateScope(policy)
  if (!sameScope(scope, policy)) deny("foreign document requirement policy scope")
  ref(policy.policyReference, "requirement policy reference")
  ref(policy.policyVersion, "requirement policy version")
  const policyStart = utc(policy.effectiveFrom, "policy effective-from")
  const policyEnd = utc(policy.validUntil, "policy valid-until")
  if (policyStart > at || at >= policyEnd || policyStart >= policyEnd)
    deny("document requirement policy is not currently effective")
  if (!Array.isArray(policy.requirements) || policy.requirements.length === 0)
    deny("mandatory-document policy absent")
  if (!Array.isArray(documents) || documents.length !== policy.requirements.length)
    deny("document evidence does not exactly cover mandatory requirements")

  const requirements = new Map<string, RequiredDocument>()
  for (const required of policy.requirements) {
    if (
      !required ||
      required.mandatory !== true ||
      typeof required.documentType !== "string" ||
      !ID.test(required.documentType) ||
      requirements.has(required.documentType) ||
      !Array.isArray(required.acceptedIssuerSystems) ||
      required.acceptedIssuerSystems.length === 0 ||
      required.acceptedIssuerSystems.some((system) => !sourceSystems.includes(system)) ||
      new Set(required.acceptedIssuerSystems).size !== required.acceptedIssuerSystems.length ||
      !Array.isArray(required.acceptedIssuerAuthorities) ||
      required.acceptedIssuerAuthorities.length === 0 ||
      required.acceptedIssuerAuthorities.some((authority) => !issuerAuthorities.includes(authority)) ||
      new Set(required.acceptedIssuerAuthorities).size !== required.acceptedIssuerAuthorities.length ||
      (required.acceptedIssuerReferences !== undefined &&
        (!Array.isArray(required.acceptedIssuerReferences) ||
          required.acceptedIssuerReferences.length === 0 ||
          required.acceptedIssuerReferences.some((issuer) => !ID.test(issuer))))
    ) deny("invalid or duplicate mandatory-document requirement")
    requirements.set(required.documentType, required)
  }

  const seenTypes = new Set<string>()
  const seenCanonical = new Set<string>()
  const seenSources = new Set<string>()
  const seenCustody = new Set<string>()
  const accepted: AcceptedDocumentEvidence[] = []
  for (const document of documents) {
    if (!document || typeof document !== "object") deny("invalid document evidence")
    const requirement = requirements.get(document.documentType)
    if (!requirement || seenTypes.has(document.documentType))
      deny("unexpected or duplicate document type")
    if (!sameScope(scope, document)) deny("foreign document business scope")
    for (const field of [
      "canonicalDocumentId",
      "sourceDocumentId",
      "documentType",
      "contentReference",
      "custodyVerificationReference",
      "issuerReference",
    ] as const) ref(document[field], field)
    if (
      document.canonicalDocumentId === document.sourceDocumentId ||
      !Number.isSafeInteger(document.version) ||
      document.version < 1 ||
      document.status !== "ISSUED" ||
      document.verificationState !== "VERIFIED" ||
      !sourceSystems.includes(document.sourceSystem) ||
      !issuerAuthorities.includes(document.issuerAuthority) ||
      !requirement.acceptedIssuerSystems.includes(document.sourceSystem) ||
      !requirement.acceptedIssuerAuthorities.includes(document.issuerAuthority) ||
      (requirement.acceptedIssuerReferences !== undefined &&
        !requirement.acceptedIssuerReferences.includes(document.issuerReference)) ||
      !SHA256.test(document.contentSha256) ||
      seenCanonical.has(document.canonicalDocumentId) ||
      seenSources.has(document.sourceDocumentId) ||
      seenCustody.has(document.custodyVerificationReference)
    ) deny("document status, issuer, provenance, checksum or custody evidence is invalid")
    currentWindow(document, at)
    seenTypes.add(document.documentType)
    seenCanonical.add(document.canonicalDocumentId)
    seenSources.add(document.sourceDocumentId)
    seenCustody.add(document.custodyVerificationReference)
    accepted.push({
      canonicalDocumentId: document.canonicalDocumentId,
      sourceDocumentId: document.sourceDocumentId,
      documentType: document.documentType,
      version: document.version,
      sourceSystem: document.sourceSystem,
      issuerAuthority: document.issuerAuthority,
      issuerReference: document.issuerReference,
      contentReference: document.contentReference,
      contentSha256: document.contentSha256,
      custodyVerificationReference: document.custodyVerificationReference,
    })
  }
  if (seenTypes.size !== requirements.size) deny("mandatory document evidence incomplete")
  return {
    scope: structuredClone(scope),
    requirementPolicyReference: policy.policyReference,
    requirementPolicyVersion: policy.policyVersion,
    acceptedDocuments: accepted,
    evaluatedAt: new Date(at).toISOString(),
  }
}
