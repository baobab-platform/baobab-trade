export type TaxTreatment = "STANDARD" | "ZERO_RATED" | "EXEMPT" | "REVERSE_CHARGE"
export type TransactionType = "GOODS" | "SHIPPING" | "DISCOUNT" | "RETURN" | "REFUND"
export type TaxPointType =
  | "ORDER_COMMITMENT"
  | "INVOICE_ISSUE"
  | "PAYMENT_RECEIPT"
  | "SHIPMENT"
  | "DELIVERY"
  | "ACCEPTANCE"
  | "IMPORT"
  | "CUSTOM_EVENT"

export type TaxPoint = {
  type: TaxPointType
  occurredAt: Date
  sourceEventReference: string
  jurisdictionKey: string
}

/**
 * Base rule shape also supports the existing provider-specific Thamani
 * projection. Generic transaction tax uses ScopedEffectiveTaxRule and does
 * not use Digital Estate as a tax determinant.
 */
export type EffectiveTaxRule = {
  digitalEstate?: string
  tenantId?: string
  marketId?: string
  marketKey?: string
  legalSellerId?: string
  legalSellerKey?: string
  sellerRegistrationReference?: string
  currency?: string
  ruleReference: string
  ruleVersion: string
  jurisdictionKey: string
  productTaxClassification: string
  transactionType: TransactionType
  treatment: TaxTreatment
  rateBasisPoints: number
  effectiveFrom: Date
  effectiveUntil?: Date | null
  sourceAuthority: string
  sourceRetrievedAt: Date
  legalReason?: string
  requiresVerifiedCustomerRegistration?: boolean
}

export type ScopedEffectiveTaxRule = EffectiveTaxRule & {
  tenantId: string
  marketId: string
  marketKey: string
  legalSellerId: string
  legalSellerKey: string
  sellerRegistrationReference: string
  currency: string
}

export type TaxDeterminationRequest = {
  determinationReference: string
  transactionReference: string
  tenantId: string
  principalId: string
  marketId: string
  marketRevision: number
  marketKey: string
  legalSellerId: string
  legalSellerKey: string
  sellerRegistrationReference: string
  organisationId?: string
  customerReference?: string
  customerTaxRegistrationReference?: string
  customerTaxRegistrationJurisdictionKey?: string
  customerTaxRegistrationVerificationStatus?:
    | "UNVERIFIED"
    | "PENDING"
    | "VERIFIED"
    | "INVALID"
    | "EXPIRED"
    | "REVOKED"
    | "ERROR"
  customerTaxRegistrationVerifiedAt?: Date
  customerTaxRegistrationVerificationSource?: string
  customerTaxRegistrationValidFrom?: Date
  customerTaxRegistrationValidUntil?: Date | null
  jurisdictionKey: string
  shipFromCountry: string
  shipToCountry: string
  billToCountry: string
  productTaxClassification: string
  transactionType: TransactionType
  currency: string
  taxableBasisMinor: number
  priceDisplayMode: "TAX_INCLUSIVE" | "TAX_EXCLUSIVE"
  taxPoint: TaxPoint
  idempotencyKey: string
  correlationId: string
}

export type TaxDetermination = TaxDeterminationRequest & {
  ruleReference: string
  ruleVersion: string
  treatment: TaxTreatment
  rateBasisPoints: number
  taxAmountMinor: number
  netAmountMinor: number
  grossAmountMinor: number
  legalReason?: string
  providerKey: string
  calculationReference: string
  sourceAuthority: string
  sourceRetrievedAt: Date
}

export interface EffectiveTaxRuleProvider {
  providerKey: string
  listRules(request: TaxDeterminationRequest): Promise<ScopedEffectiveTaxRule[]>
}

export interface TaxDeterminationPort {
  determine(request: TaxDeterminationRequest): Promise<TaxDetermination>
}

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/
const MARKET_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const MARKET_KEY = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/
const COUNTRY_CODE = /^[A-Z]{2}$/
const TAX_POINT_TYPES: readonly TaxPointType[] = [
  "ORDER_COMMITMENT",
  "INVOICE_ISSUE",
  "PAYMENT_RECEIPT",
  "SHIPMENT",
  "DELIVERY",
  "ACCEPTANCE",
  "IMPORT",
  "CUSTOM_EVENT",
]
const TREATMENTS: readonly TaxTreatment[] = [
  "STANDARD",
  "ZERO_RATED",
  "EXEMPT",
  "REVERSE_CHARGE",
]
const TRANSACTION_TYPES: readonly TransactionType[] = [
  "GOODS",
  "SHIPPING",
  "DISCOUNT",
  "RETURN",
  "REFUND",
]
const CUSTOMER_REGISTRATION_STATUSES = [
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "INVALID",
  "EXPIRED",
  "REVOKED",
  "ERROR",
] as const

const isReference = (value: unknown): value is string =>
  typeof value === "string" && REFERENCE.test(value)
const isDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime())

/**
 * Legacy Digital Estate-scoped selector retained for the existing Thamani
 * provider's explicit provider partition. Generic tax determination below
 * uses selectEffectiveRuleForContext and never treats Digital Estate as a
 * tax, seller, registration or jurisdiction dimension.
 */
export const selectEffectiveRule = (
  rules: readonly EffectiveTaxRule[],
  effectiveAt: Date,
  digitalEstate: string,
) => {
  const matches = rules.filter(
    (rule) =>
      rule.digitalEstate === digitalEstate &&
      isDate(rule.effectiveFrom) &&
      rule.effectiveFrom <= effectiveAt &&
      (!rule.effectiveUntil ||
        (isDate(rule.effectiveUntil) && effectiveAt < rule.effectiveUntil)),
  )
  if (matches.length !== 1)
    throw new Error(matches.length ? "Ambiguous effective tax rules" : "No effective tax rule")
  return matches[0]
}

/**
 * Generic rule resolution is bound to the actual transaction context:
 * tenant, Market, Legal Seller, seller registration, currency, jurisdiction,
 * classification, transaction type and tax point. Digital Estate is
 * deliberately absent.
 */
export const selectEffectiveRuleForContext = (
  rules: readonly ScopedEffectiveTaxRule[],
  request: TaxDeterminationRequest,
) => {
  const effectiveAt = request.taxPoint.occurredAt
  const matches = rules.filter(
    (rule) =>
      rule.tenantId === request.tenantId &&
      rule.marketId === request.marketId &&
      rule.marketKey === request.marketKey &&
      rule.legalSellerId === request.legalSellerId &&
      rule.legalSellerKey === request.legalSellerKey &&
      rule.sellerRegistrationReference === request.sellerRegistrationReference &&
      rule.currency === request.currency &&
      rule.jurisdictionKey === request.jurisdictionKey &&
      rule.productTaxClassification === request.productTaxClassification &&
      rule.transactionType === request.transactionType &&
      isDate(rule.effectiveFrom) &&
      rule.effectiveFrom <= effectiveAt &&
      (!rule.effectiveUntil ||
        (isDate(rule.effectiveUntil) && effectiveAt < rule.effectiveUntil)),
  )
  if (matches.length !== 1)
    throw new Error(matches.length ? "Ambiguous effective tax rules" : "No effective tax rule")
  return matches[0]
}

/**
 * ADR-0018 TAX-COM-017/018: round a non-negative exact integer ratio
 * half-up in integer minor units, never via imprecise Number multiplication.
 * The applicable rule supplies the rate; no unsupported global rate ceiling
 * is imposed here.
 */
export function roundTaxMinorUnits(
  taxableBasisMinor: number,
  rateBasisPoints: number,
  taxInclusive: boolean,
): number {
  if (!Number.isSafeInteger(taxableBasisMinor) || taxableBasisMinor < 0) {
    throw new Error("Taxable basis must be an exact non-negative minor-unit integer")
  }
  if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0) {
    throw new Error("Tax rate basis points are invalid")
  }
  const basis = BigInt(taxableBasisMinor)
  const rate = BigInt(rateBasisPoints)
  const denominator = taxInclusive ? 10_000n + rate : 10_000n
  const rounded = (basis * rate + denominator / 2n) / denominator
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Tax calculation exceeds exact minor-unit precision")
  }
  return Number(rounded)
}

const validateRequest = (request: TaxDeterminationRequest): void => {
  const hasOrganisation =
    request.organisationId !== undefined && isReference(request.organisationId)
  const hasCustomer =
    request.customerReference !== undefined && isReference(request.customerReference)
  if (
    hasOrganisation === hasCustomer ||
    (request.organisationId !== undefined && !hasOrganisation) ||
    (request.customerReference !== undefined && !hasCustomer)
  ) {
    throw new Error("Exactly one bounded tax buyer identity is required")
  }
  for (const field of [
    "determinationReference",
    "transactionReference",
    "tenantId",
    "principalId",
    "legalSellerId",
    "legalSellerKey",
    "sellerRegistrationReference",
    "jurisdictionKey",
    "productTaxClassification",
    "idempotencyKey",
    "correlationId",
  ] as const) {
    if (!isReference(request[field])) {
      throw new Error("Tax requires bounded authoritative transaction, tenant, seller and registration context")
    }
  }
  if (
    typeof request.marketId !== "string" ||
    request.marketId.length < 3 ||
    request.marketId.length > 63 ||
    !MARKET_ID.test(request.marketId) ||
    typeof request.marketKey !== "string" ||
    request.marketKey.length < 3 ||
    request.marketKey.length > 128 ||
    !MARKET_KEY.test(request.marketKey) ||
    !Number.isSafeInteger(request.marketRevision) ||
    request.marketRevision < 1
  ) {
    throw new Error("Tax requires an explicit CP Market identity, revision and canonical key")
  }
  if (
    !/^[A-Z]{3}$/.test(request.currency) ||
    !COUNTRY_CODE.test(request.shipFromCountry) ||
    !COUNTRY_CODE.test(request.shipToCountry) ||
    !COUNTRY_CODE.test(request.billToCountry)
  ) {
    throw new Error("Tax requires valid transaction currency and ISO alpha-2 supply countries")
  }
  if (
    !TRANSACTION_TYPES.includes(request.transactionType) ||
    !["TAX_INCLUSIVE", "TAX_EXCLUSIVE"].includes(request.priceDisplayMode) ||
    !Number.isSafeInteger(request.taxableBasisMinor) ||
    request.taxableBasisMinor < 0
  ) {
    throw new Error("Tax transaction type, price policy or exact taxable basis is invalid")
  }
  if (
    !request.taxPoint ||
    !TAX_POINT_TYPES.includes(request.taxPoint.type) ||
    !isDate(request.taxPoint.occurredAt) ||
    !isReference(request.taxPoint.sourceEventReference) ||
    request.taxPoint.jurisdictionKey !== request.jurisdictionKey
  ) {
    throw new Error("Tax requires an explicit, sourced TaxPoint in the resolved jurisdiction")
  }
  if (
    request.customerTaxRegistrationVerificationStatus !== undefined &&
    !CUSTOMER_REGISTRATION_STATUSES.includes(request.customerTaxRegistrationVerificationStatus)
  ) {
    throw new Error("Customer tax registration verification status is invalid")
  }
  if (
    request.customerTaxRegistrationReference !== undefined &&
    (!isReference(request.customerTaxRegistrationReference) ||
      !request.customerTaxRegistrationVerificationStatus)
  ) {
    throw new Error("Customer tax registration reference requires a verification status")
  }
  if (
    request.customerTaxRegistrationJurisdictionKey !== undefined &&
    !isReference(request.customerTaxRegistrationJurisdictionKey)
  ) {
    throw new Error("Customer tax registration jurisdiction is invalid")
  }
  if (
    request.customerTaxRegistrationVerifiedAt !== undefined &&
    !isDate(request.customerTaxRegistrationVerifiedAt)
  ) {
    throw new Error("Customer tax registration verification timestamp is invalid")
  }
  if (
    request.customerTaxRegistrationVerificationSource !== undefined &&
    !isReference(request.customerTaxRegistrationVerificationSource)
  ) {
    throw new Error("Customer tax registration verification source is invalid")
  }
  if (
    request.customerTaxRegistrationValidFrom !== undefined &&
    !isDate(request.customerTaxRegistrationValidFrom)
  ) {
    throw new Error("Customer tax registration valid-from date is invalid")
  }
  if (
    request.customerTaxRegistrationValidUntil !== undefined &&
    request.customerTaxRegistrationValidUntil !== null &&
    !isDate(request.customerTaxRegistrationValidUntil)
  ) {
    throw new Error("Customer tax registration valid-until date is invalid")
  }
  if (request.customerTaxRegistrationVerificationStatus === "VERIFIED") {
    const validFrom = request.customerTaxRegistrationValidFrom
    const validUntil = request.customerTaxRegistrationValidUntil
    if (
      !request.customerTaxRegistrationReference ||
      request.customerTaxRegistrationJurisdictionKey !== request.jurisdictionKey ||
      !request.customerTaxRegistrationVerifiedAt ||
      request.customerTaxRegistrationVerifiedAt > request.taxPoint.occurredAt ||
      !request.customerTaxRegistrationVerificationSource ||
      !validFrom ||
      (validFrom && request.taxPoint.occurredAt < validFrom) ||
      (validUntil && request.taxPoint.occurredAt >= validUntil) ||
      (validFrom && validUntil && validFrom >= validUntil)
    ) {
      throw new Error("Verified customer tax registration lacks matching effective jurisdiction or verification evidence")
    }
  }
}

export class EffectiveDatedTaxProviderAdapter implements TaxDeterminationPort {
  constructor(private readonly provider: EffectiveTaxRuleProvider) {}

  async determine(request: TaxDeterminationRequest): Promise<TaxDetermination> {
    validateRequest(request)
    if (!isReference(this.provider.providerKey)) {
      throw new Error("Tax provider identity is invalid")
    }
    const rule = selectEffectiveRuleForContext(
      await this.provider.listRules(request),
      request,
    )
    if (
      !isReference(rule.ruleReference) ||
      !isReference(rule.ruleVersion) ||
      !isReference(rule.sourceAuthority) ||
      !isDate(rule.sourceRetrievedAt) ||
      !isDate(rule.effectiveFrom) ||
      (rule.effectiveUntil !== undefined &&
        rule.effectiveUntil !== null &&
        !isDate(rule.effectiveUntil)) ||
      (rule.effectiveUntil && rule.effectiveFrom >= rule.effectiveUntil) ||
      !TREATMENTS.includes(rule.treatment) ||
      typeof rule.requiresVerifiedCustomerRegistration !== "boolean" &&
        rule.requiresVerifiedCustomerRegistration !== undefined
    ) {
      throw new Error("Tax decision lacks valid rule identity, effective period or provenance")
    }
    if (
      ["ZERO_RATED", "EXEMPT", "REVERSE_CHARGE"].includes(rule.treatment) &&
      !isReference(rule.legalReason)
    ) {
      throw new Error("Protected zero-tax treatment requires legal reason provenance")
    }
    if (
      rule.requiresVerifiedCustomerRegistration &&
      request.customerTaxRegistrationVerificationStatus !== "VERIFIED"
    ) {
      throw new Error("Tax rule requires verified customer tax registration")
    }
    const standardTax = roundTaxMinorUnits(
      request.taxableBasisMinor,
      rule.rateBasisPoints,
      request.priceDisplayMode === "TAX_INCLUSIVE",
    )
    const taxAmountMinor = rule.treatment === "STANDARD" ? standardTax : 0
    const netAmountMinor =
      request.priceDisplayMode === "TAX_INCLUSIVE"
        ? request.taxableBasisMinor - taxAmountMinor
        : request.taxableBasisMinor
    const grossAmountMinor = netAmountMinor + taxAmountMinor
    if (
      !Number.isSafeInteger(netAmountMinor) ||
      netAmountMinor < 0 ||
      !Number.isSafeInteger(grossAmountMinor)
    ) {
      throw new Error("Tax totals exceed exact minor-unit precision")
    }
    return {
      ...request,
      ruleReference: rule.ruleReference,
      ruleVersion: rule.ruleVersion,
      treatment: rule.treatment,
      rateBasisPoints: rule.rateBasisPoints,
      taxAmountMinor,
      netAmountMinor,
      grossAmountMinor,
      legalReason: rule.legalReason,
      providerKey: this.provider.providerKey,
      calculationReference: `${request.determinationReference}:${rule.ruleVersion}`,
      sourceAuthority: rule.sourceAuthority,
      sourceRetrievedAt: rule.sourceRetrievedAt,
    }
  }
}
