/**
 * ADR-0021: internal regulatory execution gate. This does not decide law,
 * classify products, authenticate provider signatures or create evidence.
 *
 * The caller must obtain the complete requirement set and exact provider
 * bindings from the trusted CP resolver before passing them here.
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

export type RegulatoryStatus =
  | "NOT_EVALUATED"
  | "PENDING"
  | "PASS"
  | "PASS_WITH_CONDITIONS"
  | "REVIEW_REQUIRED"
  | "BLOCKED"
  | "EXPIRED"
  | "ERROR"
  | "NO_PROVIDER"

export type RegulatoryContext = Readonly<{
  tenantId: string
  transactionReference: string
  sellerLegalEntityId: string
  buyerOrganisationId: string
  buyerLegalEntityId: string
  marketId: string
  marketRevision: number
  shipmentOriginCountry: string
  destinationCountry: string
  tradeLaneId?: string
  incoterm?: "EXW" | "FCA" | "FOB" | "CFR" | "CIF" | "DAP" | "DPU" | "DDP"
  customsOriginCountry?: string
  countryOfProduction?: string
  productId: string
  classificationSystem?: string
  classificationCode?: string
  classificationVersion?: string
  classificationReference?: string
}>

export type RequiredRegulatoryCheck = Readonly<{
  check: RegulatoryCheck
  providerId: string
  bindingReference: string
  providerVersion: string
  bindingVersion: string
}>

export type RegulatoryEvidence = Readonly<{
  check: RegulatoryCheck
  status: RegulatoryStatus
  providerId: string
  bindingReference: string
  providerVersion: string
  bindingVersion: string
  decisionReference: string
  evidenceReference: string
  decidedAt: string
  expiresAt: string
  context: RegulatoryContext
}>

export type RegulatoryClearance = Readonly<{
  context: RegulatoryContext
  approvedChecks: readonly RegulatoryCheck[]
  decisionReferences: readonly string[]
  evidenceReferences: readonly string[]
  providerBindings: readonly RequiredRegulatoryCheck[]
  clearedAt: string
}>

export class RegulatoryClearanceRefusal extends Error {
  constructor(readonly reason: string) {
    super("ADR-0021 clearance refused: " + reason)
  }
}
const refuse = (reason: string): never => {
  throw new RegulatoryClearanceRefusal(reason)
}
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const COUNTRY = /^[A-Z]{2}$/
const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DPU", "DDP"] as const
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
const statuses: readonly RegulatoryStatus[] = [
  "NOT_EVALUATED",
  "PENDING",
  "PASS",
  "PASS_WITH_CONDITIONS",
  "REVIEW_REQUIRED",
  "BLOCKED",
  "EXPIRED",
  "ERROR",
  "NO_PROVIDER",
]
const contextFields: readonly (keyof RegulatoryContext)[] = [
  "tenantId",
  "transactionReference",
  "sellerLegalEntityId",
  "buyerOrganisationId",
  "buyerLegalEntityId",
  "marketId",
  "marketRevision",
  "shipmentOriginCountry",
  "destinationCountry",
  "tradeLaneId",
  "incoterm",
  "customsOriginCountry",
  "countryOfProduction",
  "productId",
  "classificationSystem",
  "classificationCode",
  "classificationVersion",
  "classificationReference",
]

const validId = (value: unknown): value is string =>
  typeof value === "string" && IDENTIFIER.test(value)
const time = (value: unknown, label: string): number => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) return refuse("invalid " + label)
  const milliseconds = Date.parse(value)
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 19) !== value.slice(0, 19)
  ) return refuse("invalid " + label)
  return milliseconds
}
const requiredText = (value: unknown, label: string): void => {
  if (!validId(value)) refuse("missing or invalid " + label)
}

const validateContext = (
  context: RegulatoryContext,
  required: readonly RequiredRegulatoryCheck[],
): void => {
  for (const field of [
    "tenantId",
    "transactionReference",
    "sellerLegalEntityId",
    "buyerOrganisationId",
    "buyerLegalEntityId",
    "marketId",
    "productId",
  ] as const) requiredText(context[field], field)
  if (
    !Number.isSafeInteger(context.marketRevision) ||
    context.marketRevision < 1 ||
    !COUNTRY.test(context.shipmentOriginCountry) ||
    !COUNTRY.test(context.destinationCountry)
  ) refuse("invalid Market revision or shipment country context")
  if (context.shipmentOriginCountry !== context.destinationCountry) {
    if (
      !validId(context.tradeLaneId) ||
      !context.incoterm ||
      !INCOTERMS.includes(context.incoterm)
    ) refuse("cross-border context requires Trade Lane and Incoterm")
  }
  if (
    context.customsOriginCountry !== undefined &&
    !COUNTRY.test(context.customsOriginCountry)
  ) refuse("invalid customs origin country")
  if (
    context.countryOfProduction !== undefined &&
    !COUNTRY.test(context.countryOfProduction)
  ) refuse("invalid country of production")
  if (required.some((item) => item.check === "PRODUCT_CLASSIFICATION")) {
    for (const field of [
      "classificationSystem",
      "classificationCode",
      "classificationVersion",
      "classificationReference",
    ] as const) requiredText(context[field], field)
  }
  if (
    required.some((item) => item.check === "ORIGIN") &&
    (!context.customsOriginCountry || !context.countryOfProduction)
  ) refuse("origin check requires customs origin and country of production")
}

const sameContext = (a: RegulatoryContext, b: RegulatoryContext): boolean =>
  contextFields.every((field) => a[field] === b[field])

/**
 * This is a consistency gate over trusted CP requirement/binding resolution
 * and provider evidence. It does not authenticate those external sources.
 */
export function assertRegulatoryExecutionClearance(
  context: RegulatoryContext,
  required: readonly RequiredRegulatoryCheck[],
  evidence: readonly RegulatoryEvidence[],
  effectiveAt: string,
): RegulatoryClearance {
  const now = time(effectiveAt, "effective time")
  if (!Array.isArray(required) || required.length === 0 || !Array.isArray(evidence))
    refuse("no authoritative required-check set")
  validateContext(context, required)
  const requiredByCheck = new Map<RegulatoryCheck, RequiredRegulatoryCheck>()
  for (const item of required) {
    if (
      !item ||
      !supported.includes(item.check) ||
      !validId(item.providerId) ||
      !validId(item.bindingReference) ||
      !validId(item.providerVersion) ||
      !validId(item.bindingVersion) ||
      requiredByCheck.has(item.check)
    ) refuse("invalid or duplicate required provider binding")
    requiredByCheck.set(item.check, item)
  }
  if (evidence.length !== required.length) refuse("evidence does not exactly cover required checks")
  const byCheck = new Map<RegulatoryCheck, RegulatoryEvidence>()
  const decisions = new Set<string>()
  const evidenceReferences = new Set<string>()
  for (const result of evidence) {
    if (
      !result ||
      !supported.includes(result.check) ||
      !statuses.includes(result.status) ||
      byCheck.has(result.check)
    ) refuse("unknown or duplicate regulatory assessment")
    const binding = requiredByCheck.get(result.check)
    if (
      !binding ||
      result.providerId !== binding.providerId ||
      result.bindingReference !== binding.bindingReference ||
      result.providerVersion !== binding.providerVersion ||
      result.bindingVersion !== binding.bindingVersion
    ) refuse("provider result does not match the CP-resolved binding")
    if (result.status !== "PASS") refuse("mandatory regulatory check not cleared: " + result.check)
    for (const field of [
      "providerId",
      "bindingReference",
      "providerVersion",
      "bindingVersion",
      "decisionReference",
      "evidenceReference",
    ] as const) requiredText(result[field], field)
    if (
      decisions.has(result.decisionReference) ||
      evidenceReferences.has(result.evidenceReference)
    ) refuse("reused regulatory decision or evidence reference")
    const decided = time(result.decidedAt, "decision time")
    const expires = time(result.expiresAt, "expiry")
    if (decided > now || now >= expires || decided >= expires)
      refuse("stale or future-dated regulatory decision")
    if (!sameContext(context, result.context))
      refuse("foreign or mismatched regulatory transaction context")
    decisions.add(result.decisionReference)
    evidenceReferences.add(result.evidenceReference)
    byCheck.set(result.check, result)
  }
  if (byCheck.size !== requiredByCheck.size) refuse("missing mandatory regulatory check")
  return {
    context,
    approvedChecks: required.map((item) => item.check),
    decisionReferences: evidence.map((item) => item.decisionReference),
    evidenceReferences: evidence.map((item) => item.evidenceReference),
    providerBindings: required,
    clearedAt: new Date(now).toISOString(),
  }
}
