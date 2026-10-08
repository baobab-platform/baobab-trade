export type PricingKind = "STANDARD_WHOLESALE" | "VOLUME" | "CONTRACT" | "CUSTOMER_SPECIFIC"

export type PriceCandidate = {
  kind: PricingKind
  amount: number
  currencyCode: string
  minQuantity?: number
  maxQuantity?: number
  organisationId?: string
}

export type PricingDecisionRequest = {
  variantId: string
  marketKey: string
  organisationId: string
  currencyCode: string
  quantity: number
}

export type PricingDecision = PriceCandidate & {
  variantId: string
  marketKey: string
}

export interface PricingDecisionPort {
  decide(request: PricingDecisionRequest): Promise<PricingDecision>
}

export interface PriceCandidateProvider {
  listCandidates(request: PricingDecisionRequest): Promise<PriceCandidate[]>
}

/** Native Medusa remains active behind this extraction seam. */
export class MedusaPricingDecisionAdapter implements PricingDecisionPort {
  constructor(private readonly candidates: PriceCandidateProvider) {}
  async decide(request: PricingDecisionRequest): Promise<PricingDecision> {
    return selectPrice(request, await this.candidates.listCandidates(request))
  }
}

const precedence: Record<PricingKind, number> = {
  STANDARD_WHOLESALE: 1,
  VOLUME: 2,
  CONTRACT: 3,
  CUSTOMER_SPECIFIC: 4,
}

export const selectPrice = (
  request: PricingDecisionRequest,
  candidates: readonly PriceCandidate[],
): PricingDecision => {
  if (!Number.isInteger(request.quantity) || request.quantity <= 0) {
    throw new Error("Quantity must be a positive integer")
  }

  const eligible = candidates.filter(
    (candidate) =>
      candidate.currencyCode.toLowerCase() === request.currencyCode.toLowerCase() &&
      (candidate.organisationId === undefined ||
        candidate.organisationId === request.organisationId) &&
      (candidate.minQuantity === undefined || request.quantity >= candidate.minQuantity) &&
      (candidate.maxQuantity === undefined || request.quantity <= candidate.maxQuantity),
  )

  const selected = eligible.sort((a, b) => precedence[b.kind] - precedence[a.kind])[0]
  if (!selected) throw new Error("No authorised price is available for this purchase context")

  return { ...selected, variantId: request.variantId, marketKey: request.marketKey }
}

export const assertOrderQuantity = (quantity: number, minimum: number, multiple: number): void => {
  if (!Number.isInteger(quantity) || quantity < minimum || quantity % multiple !== 0) {
    throw new Error(`Quantity must be at least ${minimum} and ordered in multiples of ${multiple}`)
  }
}

export const assertMarketEligibility = (
  requestedMarketKey: string,
  eligibility: { marketKey: string; status: "ACTIVE" | "SUSPENDED" | "WITHDRAWN" },
): void => {
  if (eligibility.marketKey !== requestedMarketKey || eligibility.status !== "ACTIVE") {
    throw new Error("Product is not eligible in the requested Market")
  }
}
