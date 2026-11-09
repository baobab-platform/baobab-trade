export type PricingKind = "STANDARD_WHOLESALE" | "VOLUME" | "CONTRACT" | "CUSTOMER_SPECIFIC"

export type PriceCandidate = {
  kind: PricingKind
  amount: number
  currencyCode: string
  minQuantity?: number
  maxQuantity?: number
  organisationId?: string
  /** Optional authoritative scope; absent means a legacy unscoped candidate. */
  marketKey?: string
  variantId?: string
  legalSellerId?: string
  effectiveFrom?: string
  effectiveUntil?: string
}

export type PricingDecisionRequest = {
  variantId: string
  marketKey: string
  organisationId: string
  currencyCode: string
  quantity: number
  /** Required for candidates governed by legal-seller scope. */
  legalSellerId?: string
  /** Server-owned effective instant; never accept browser-supplied pricing time. */
  effectiveAt?: string
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

const isValidInstant = (value: string): boolean =>
  /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value))

const isPositiveMinorAmount = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0

/**
 * ADR-0012 §§4–5, 22–24, 67–70, 92–94, 104–105:
 * all eligible prices must be unambiguous, scoped and deterministic.
 * This pure decision helper does not replace Medusa's native pricing engine.
 */
export const selectPrice = (
  request: PricingDecisionRequest,
  candidates: readonly PriceCandidate[],
): PricingDecision => {
  if (
    !request.variantId ||
    !request.marketKey ||
    !request.organisationId ||
    !/^[a-z]{3}$/.test(request.currencyCode.toLowerCase()) ||
    !Number.isInteger(request.quantity) ||
    request.quantity <= 0
  ) {
    throw new Error("Invalid pricing context")
  }
  const effectiveAt = request.effectiveAt === undefined ? Date.now() : Date.parse(request.effectiveAt)
  if (
    (request.effectiveAt !== undefined && !isValidInstant(request.effectiveAt)) ||
    !Number.isFinite(effectiveAt)
  ) {
    throw new Error("Invalid effective pricing instant")
  }

  // Invalid candidates must not be silently selected or interpreted as
  // unbounded. A malformed provider response is a refusal, not a fallback.
  for (const candidate of candidates) {
    if (
      !Object.hasOwn(precedence, candidate.kind) ||
      !isPositiveMinorAmount(candidate.amount) ||
      typeof candidate.currencyCode !== "string" ||
      (candidate.minQuantity !== undefined &&
        (!Number.isSafeInteger(candidate.minQuantity) || candidate.minQuantity <= 0)) ||
      (candidate.maxQuantity !== undefined &&
        (!Number.isSafeInteger(candidate.maxQuantity) || candidate.maxQuantity <= 0)) ||
      (candidate.minQuantity !== undefined &&
        candidate.maxQuantity !== undefined &&
        candidate.minQuantity > candidate.maxQuantity) ||
      (candidate.effectiveFrom !== undefined && !isValidInstant(candidate.effectiveFrom)) ||
      (candidate.effectiveUntil !== undefined && !isValidInstant(candidate.effectiveUntil)) ||
      (candidate.effectiveFrom !== undefined &&
        candidate.effectiveUntil !== undefined &&
        Date.parse(candidate.effectiveFrom) >= Date.parse(candidate.effectiveUntil)) ||
      (candidate.marketKey !== undefined && !candidate.marketKey) ||
      (candidate.variantId !== undefined && !candidate.variantId) ||
      (candidate.legalSellerId !== undefined && !candidate.legalSellerId)
    ) {
      throw new Error("Invalid pricing candidate")
    }
  }

  const eligible = candidates.filter(
    (candidate) =>
      candidate.currencyCode.toLowerCase() === request.currencyCode.toLowerCase() &&
      (candidate.organisationId === undefined ||
        candidate.organisationId === request.organisationId) &&
      (candidate.marketKey === undefined || candidate.marketKey === request.marketKey) &&
      (candidate.variantId === undefined || candidate.variantId === request.variantId) &&
      (candidate.legalSellerId === undefined ||
        (request.legalSellerId !== undefined && candidate.legalSellerId === request.legalSellerId)) &&
      (candidate.effectiveFrom === undefined || Date.parse(candidate.effectiveFrom) <= effectiveAt) &&
      (candidate.effectiveUntil === undefined || effectiveAt < Date.parse(candidate.effectiveUntil)) &&
      (candidate.minQuantity === undefined || request.quantity >= candidate.minQuantity) &&
      (candidate.maxQuantity === undefined || request.quantity <= candidate.maxQuantity),
  )

  const ranked = eligible.sort((a, b) => precedence[b.kind] - precedence[a.kind])
  const selected = ranked[0]
  if (!selected) throw new Error("No authorised price is available for this purchase context")

  // Never pick whichever same-precedence record the provider happened to
  // return first: overlapping contracts/tiers are policy conflicts.
  if (ranked.length > 1 && precedence[ranked[1].kind] === precedence[selected.kind]) {
    throw new Error("Ambiguous applicable pricing rules")
  }

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
