/**
 * ADR-0012 PRC-COM-004/006/007/011/015/016/027/028:
 * the B2B provider supplies scoped, minor-unit Commerce candidates.
 * Selection never grants buyer authority: membership and legal seller
 * must be verified by the caller before this decision reaches checkout.
 */
export type PricingKind = "STANDARD_WHOLESALE" | "VOLUME" | "CONTRACT" | "CUSTOMER_SPECIFIC"

export type PriceCandidate = {
  kind: PricingKind
  /** Safe integer in the currency's native minor units; not a float price. */
  amount: number
  variantId: string
  marketKey: string
  currencyCode: string
  minQuantity?: number
  maxQuantity?: number
  organisationId?: string
  status?: "ACTIVE" | "DRAFT" | "SUSPENDED" | "EXPIRED"
  effectiveFrom?: Date | string | null
  effectiveUntil?: Date | string | null
  agreementReference?: string
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

const boundary = (value: Date | string | null | undefined, fallback: number): number => {
  if (value == null) return fallback
  return value instanceof Date ? value.getTime() : Date.parse(value)
}

export const selectPrice = (
  request: PricingDecisionRequest,
  candidates: readonly PriceCandidate[],
  now = Date.now(),
): PricingDecision => {
  if (
    !request.variantId ||
    !request.marketKey ||
    !request.organisationId ||
    !/^[a-z]{3}$/i.test(request.currencyCode) ||
    !Number.isSafeInteger(request.quantity) ||
    request.quantity <= 0 ||
    !Number.isFinite(now)
  ) {
    throw new Error("Pricing requires a valid, authorised Commerce context and quantity")
  }
  const eligible: PriceCandidate[] = []
  for (const candidate of candidates) {
    // An engine/native price is never allowed to cross its variant or Market.
    if (
      candidate.variantId !== request.variantId ||
      candidate.marketKey !== request.marketKey ||
      candidate.currencyCode.toLowerCase() !== request.currencyCode.toLowerCase()
    ) continue

    const privateKind =
      candidate.kind === "CONTRACT" || candidate.kind === "CUSTOMER_SPECIFIC"
    // An unscoped PRIVATE price is a disclosure, not a public list price.
    if (privateKind && !candidate.organisationId) continue
    if (candidate.organisationId && candidate.organisationId !== request.organisationId) continue
    if (candidate.status !== undefined && candidate.status !== "ACTIVE") continue
    const from = boundary(candidate.effectiveFrom, -Infinity)
    const until = boundary(candidate.effectiveUntil, Infinity)
    if (!Number.isFinite(from) && from !== -Infinity) continue
    if (!Number.isFinite(until) && until !== Infinity) continue
    if (from >= until || now < from || now >= until) continue
    if (
      !Number.isSafeInteger(candidate.minQuantity ?? 1) ||
      (candidate.minQuantity ?? 1) <= 0 ||
      (candidate.maxQuantity !== undefined &&
        (!Number.isSafeInteger(candidate.maxQuantity) ||
          candidate.maxQuantity < (candidate.minQuantity ?? 1)))
    ) {
      throw new Error("Pricing candidate contains an invalid quantity tier")
    }
    if (
      request.quantity < (candidate.minQuantity ?? 1) ||
      (candidate.maxQuantity !== undefined && request.quantity > candidate.maxQuantity)
    ) continue
    if (!Object.hasOwn(precedence, candidate.kind)) {
      throw new Error("Unknown price precedence")
    }
    if (!Number.isSafeInteger(candidate.amount) || candidate.amount < 0) {
      throw new Error("Pricing amounts must use safe integer minor units")
    }
    eligible.push(candidate)
  }

  const highest = eligible.reduce((p, c) => Math.max(p, precedence[c.kind]), 0)
  const winners = eligible.filter((c) => precedence[c.kind] === highest)
  if (winners.length === 0) {
    throw new Error("No authorised price is available for this purchase context")
  }
  // Overlapping contract/volume rules must be repaired, not resolved using
  // database result ordering or "choose the lowest price".
  if (winners.length !== 1) {
    throw new Error("Ambiguous price precedence: overlapping eligible candidates")
  }
  return { ...winners[0], variantId: request.variantId, marketKey: request.marketKey }
}

export const assertOrderQuantity = (quantity: number, minimum: number, multiple: number): void => {
  if (
    !Number.isSafeInteger(quantity) ||
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(multiple) ||
    minimum <= 0 ||
    multiple <= 0 ||
    quantity < minimum ||
    quantity % multiple !== 0
  ) {
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
