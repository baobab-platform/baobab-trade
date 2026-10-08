import { validateCrossBorderMetadata, type CrossBorderTransactionMetadata } from "./trade-metadata"
export type ComplianceDecision = {
  decisionReference: string
  status: "APPROVED" | "REJECTED" | "REVIEW_REQUIRED"
  policyReference: string
  policyVersion: string
  reasons: string[]
  decidedAt: Date
  expiresAt?: Date
  source: string
}
export type TradeLanePolicy = {
  digitalEstate: string
  policyReference: string
  policyVersion: string
  originCountry: string
  destinationCountry: string
  permittedIncoterms: string[]
  permittedTradeUoms: string[]
  effectiveFrom: Date
  effectiveUntil?: Date | null
  source: string
}
export interface TradeCompliancePort {
  evaluate(
    transaction: CrossBorderTransactionMetadata,
    effectiveAt: Date,
  ): Promise<ComplianceDecision>
}
export interface TradeLanePolicyProvider {
  listPolicies(originCountry: string, destinationCountry: string): Promise<TradeLanePolicy[]>
}
export interface TradeProfileVerificationProvider {
  isVerified(input: {
    canonicalProductKey: string
    marketKey: string
    hsClassificationReference: string
    effectiveAt: Date
  }): Promise<boolean>
}
export class ProjectedTradeComplianceAdapter implements TradeCompliancePort {
  constructor(
    private readonly policies: TradeLanePolicyProvider,
    private readonly profiles: TradeProfileVerificationProvider,
  ) {}
  async evaluate(
    transaction: CrossBorderTransactionMetadata,
    effectiveAt: Date,
  ): Promise<ComplianceDecision> {
    validateCrossBorderMetadata(transaction)
    const policies = (
      await this.policies.listPolicies(transaction.originCountry, transaction.destinationCountry)
    ).filter(
      (policy) =>
        // ZuriBeans and Thamani can share an origin/destination country pair — a lane policy
        // belonging to the other Digital Estate must never satisfy this transaction, even when
        // countries and effective-dating otherwise line up.
        policy.digitalEstate === transaction.digitalEstate &&
        policy.effectiveFrom <= effectiveAt &&
        (!policy.effectiveUntil || effectiveAt < policy.effectiveUntil),
    )
    if (policies.length !== 1)
      throw new Error(
        policies.length
          ? "Ambiguous effective trade lane policy"
          : "No effective trade lane policy",
      )
    const policy = policies[0]
    const reasons: string[] = []
    if (!policy.permittedIncoterms.includes(transaction.incoterm))
      reasons.push("INCOTERM_REVIEW_REQUIRED")
    if (transaction.lines.some((line) => !policy.permittedTradeUoms.includes(line.tradeUom)))
      reasons.push("TRADE_UOM_REVIEW_REQUIRED")
    const verified = await Promise.all(
      transaction.lines.map((line) =>
        this.profiles.isVerified({
          canonicalProductKey: line.canonicalProductKey,
          marketKey: transaction.marketKey,
          hsClassificationReference: line.hsClassificationReference,
          effectiveAt,
        }),
      ),
    )
    if (verified.some((value) => !value)) reasons.push("HS_CLASSIFICATION_UNVERIFIED")
    return {
      decisionReference: `${transaction.transactionReference}:${policy.policyVersion}`,
      status: reasons.length ? "REVIEW_REQUIRED" : "APPROVED",
      policyReference: policy.policyReference,
      policyVersion: policy.policyVersion,
      reasons,
      decidedAt: effectiveAt,
      source: policy.source,
    }
  }
}
