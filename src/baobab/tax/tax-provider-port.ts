import {
  THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
  ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
} from "../context/digital-estates"

export type TaxTreatment = "STANDARD" | "ZERO_RATED" | "EXEMPT" | "REVERSE_CHARGE"
export type TransactionType = "GOODS" | "SHIPPING" | "DISCOUNT" | "RETURN" | "REFUND"

export type EffectiveTaxRule = {
  digitalEstate: string
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
}

export type TaxDeterminationRequest = {
  determinationReference: string
  marketKey: string
  legalSellerKey: string
  sellerRegistrationReference: string
  organisationId?: string
  customerReference?: string
  customerTaxRegistrationReference?: string
  customerTaxVerificationStatus?: "VERIFIED" | "UNVERIFIED" | "EXPIRED" | "REJECTED"
  jurisdictionKey: string
  shipFromCountry: string
  shipToCountry: string
  billToCountry: string
  productTaxClassification: string
  transactionType: TransactionType
  currency: string
  taxableBasisMinor: number
  priceDisplayMode: "TAX_INCLUSIVE" | "TAX_EXCLUSIVE"
  effectiveAt: Date
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
  priceDisplayMode: "TAX_INCLUSIVE" | "TAX_EXCLUSIVE"
  legalReason?: string
  providerKey: string
  calculationReference: string
  sourceAuthority: string
  sourceRetrievedAt: Date
}

export interface EffectiveTaxRuleProvider {
  providerKey: string
  listRules(request: TaxDeterminationRequest): Promise<EffectiveTaxRule[]>
}

export interface TaxDeterminationPort {
  determine(request: TaxDeterminationRequest): Promise<TaxDetermination>
}

export const selectEffectiveRule = (
  rules: readonly EffectiveTaxRule[],
  effectiveAt: Date,
  digitalEstate: string,
) => {
  const matches = rules.filter(
    (rule) =>
      rule.digitalEstate === digitalEstate &&
      rule.effectiveFrom <= effectiveAt &&
      (!rule.effectiveUntil || effectiveAt < rule.effectiveUntil),
  )
  if (matches.length !== 1)
    throw new Error(matches.length ? "Ambiguous effective tax rules" : "No effective tax rule")
  return matches[0]
}

export class EffectiveDatedTaxProviderAdapter implements TaxDeterminationPort {
  constructor(private readonly provider: EffectiveTaxRuleProvider) {}
  async determine(request: TaxDeterminationRequest): Promise<TaxDetermination> {
    if (Boolean(request.organisationId) === Boolean(request.customerReference))
      throw new Error("Exactly one tax subject is required")
    if (!Number.isSafeInteger(request.taxableBasisMinor) || request.taxableBasisMinor < 0)
      throw new Error("Taxable basis must be a non-negative integer in minor units")
    // A ZuriBeans (B2B) request always carries organisationId, a Thamani (B2C) request always
    // carries customerReference — the XOR check above already guarantees exactly one. Rules
    // belonging to the other Digital Estate must never match here, even when jurisdiction,
    // classification, and transaction type otherwise line up (they can, since ZuriBeans and
    // Thamani share Markets/currencies per country).
    const digitalEstate = request.organisationId
      ? ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID
      : THAMANI_DIGITAL_ESTATE_CANONICAL_ID
    const rule = selectEffectiveRule(
      await this.provider.listRules(request),
      request.effectiveAt,
      digitalEstate,
    )
    if (
      rule.jurisdictionKey !== request.jurisdictionKey ||
      rule.productTaxClassification !== request.productTaxClassification ||
      rule.transactionType !== request.transactionType
    )
      throw new Error("Tax provider returned a rule outside the requested context")
    if (["ZERO_RATED", "EXEMPT", "REVERSE_CHARGE"].includes(rule.treatment) && !rule.legalReason)
      throw new Error("Protected zero-tax treatment requires legal reason provenance")
    const priceDisplayMode = request.priceDisplayMode
    const taxAmountMinor =
      rule.treatment !== "STANDARD"
        ? 0
        : priceDisplayMode === "TAX_INCLUSIVE"
          ? Math.round(
              (request.taxableBasisMinor * rule.rateBasisPoints) / (10_000 + rule.rateBasisPoints),
            )
          : Math.round((request.taxableBasisMinor * rule.rateBasisPoints) / 10_000)
    const netAmountMinor =
      priceDisplayMode === "TAX_INCLUSIVE"
        ? request.taxableBasisMinor - taxAmountMinor
        : request.taxableBasisMinor
    const grossAmountMinor = netAmountMinor + taxAmountMinor
    return {
      ...request,
      ruleReference: rule.ruleReference,
      ruleVersion: rule.ruleVersion,
      treatment: rule.treatment,
      rateBasisPoints: rule.rateBasisPoints,
      taxAmountMinor,
      netAmountMinor,
      grossAmountMinor,
      priceDisplayMode,
      legalReason: rule.legalReason,
      providerKey: this.provider.providerKey,
      calculationReference: `${request.determinationReference}:${rule.ruleVersion}`,
      sourceAuthority: rule.sourceAuthority,
      sourceRetrievedAt: rule.sourceRetrievedAt,
    }
  }
}
