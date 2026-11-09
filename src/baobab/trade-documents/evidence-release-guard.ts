/**
 * ADR-0025 provider-neutral trade document evidence-release guard.
 * This does NOT persist documents, scan uploads, verify object bytes or
 * authenticate a storage service. Inputs must be attested by their owners.
 */
export type DocumentBusinessScope = {
  tenantId: string
  legalEntityId: string
  transactionId: string
}
export type TradeDocumentEvidence = DocumentBusinessScope & {
  canonicalDocumentId: string
  sourceSystem: "TRADE" | "ERP" | "REGULATORY_PROVIDER" | "LOGISTICS_PROVIDER" | "EXTERNAL_ISSUER"
  sourceDocumentId: string
  documentType: string
  version: number
  contentReference: string
  contentSha256: string
  custodyVerificationReference: string
  issuerReference: string
  issuedAt: string
  validUntil: string
  status: "ISSUED" | "PENDING" | "REVOKED" | "SUPERSEDED" | "EXPIRED"
  verificationState: "VERIFIED" | "PENDING" | "UNVERIFIED" | "REJECTED" | "REVOKED"
}
export type RequiredDocument = {
  documentType: string
  acceptedIssuerSystems: readonly TradeDocumentEvidence["sourceSystem"][]
}
export class DocumentEvidenceRefusal extends Error {
  constructor(readonly reason: string) {
    super("ADR-0025 document evidence refused: " + reason)
  }
}
const deny = (reason: string): never => {
  throw new DocumentEvidenceRefusal(reason)
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const ref = (s: unknown, name: string): void => {
  if (typeof s !== "string" || !ID.test(s)) deny("invalid " + name)
}
const utc = (s: string) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s))
    return deny("invalid document timestamp")
  const n = Date.parse(s)
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 19) !== s.slice(0, 19))
    return deny("invalid document timestamp")
  return n
}
const systems = ["TRADE", "ERP", "REGULATORY_PROVIDER", "LOGISTICS_PROVIDER", "EXTERNAL_ISSUER"]

/**
 * Only active and verified evidence can meet mandatory requirements. Content
 * hash and custody reference must be supplied by an independently verified
 * storage/evidence port, never by an uploader asserting their own verification.
 */
export function assertDocumentPackageRelease(
  scope: DocumentBusinessScope,
  requirements: readonly RequiredDocument[],
  documents: readonly TradeDocumentEvidence[],
  now: string,
): { documentVersions: string[]; custodyReferences: string[] } {
  const at = utc(now)
  for (const field of ["tenantId", "legalEntityId", "transactionId"] as const)
    ref(scope[field], field)
  if (!Array.isArray(requirements) || requirements.length === 0 ||
      !Array.isArray(documents)) deny("mandatory-document policy absent")
  const requiredTypes = new Set<string>()
  for (const required of requirements) {
    ref(required.documentType, "required document type")
    if (requiredTypes.has(required.documentType) || !Array.isArray(required.acceptedIssuerSystems) ||
        !required.acceptedIssuerSystems.length ||
        required.acceptedIssuerSystems.some((system) => !systems.includes(system)))
      deny("invalid required-document policy")
    requiredTypes.add(required.documentType)
  }
  const consumed = new Set<string>()
  const versions: string[] = []
  const custody: string[] = []
  for (const required of requirements) {
    const matches = documents.filter((doc) => doc.documentType === required.documentType)
    if (matches.length !== 1) deny("missing or ambiguous document: " + required.documentType)
    const doc = matches[0]
    for (const field of ["tenantId", "legalEntityId", "transactionId"] as const) {
      ref(doc[field], field)
      if (scope[field] !== doc[field]) deny("foreign document business scope")
    }
    if (!required.acceptedIssuerSystems.includes(doc.sourceSystem))
      deny("unapproved document source authority")
    for (const field of [
      "canonicalDocumentId", "sourceDocumentId", "documentType",
      "contentReference", "custodyVerificationReference", "issuerReference",
    ] as const) ref(doc[field], field)
    if (doc.canonicalDocumentId === doc.sourceDocumentId)
      deny("canonical document identity cannot be source document identity")
    if (!Number.isSafeInteger(doc.version) || doc.version < 1)
      deny("document version must be positive")
    if (!/^[a-f0-9]{64}$/.test(doc.contentSha256))
      deny("document content checksum is missing or malformed")
    const issued = utc(doc.issuedAt)
    const until = utc(doc.validUntil)
    if (issued > at || issued >= until || at >= until)
      deny("document not effective")
    if (doc.status !== "ISSUED" || doc.verificationState !== "VERIFIED")
      deny("document is not verified and issued")
    const key = doc.canonicalDocumentId + ":" + doc.version
    if (consumed.has(key)) deny("same document version substituted for multiple requirements")
    consumed.add(key)
    versions.push(key)
    custody.push(doc.custodyVerificationReference)
  }
  if (new Set(custody).size !== custody.length)
    deny("same custody proof reused across required documents")
  return { documentVersions: versions, custodyReferences: custody }
}
