import { createHash } from "node:crypto"

/**
 * ADR-0020 internal commercial pricing kernel. This is NOT a public endpoint,
 * ERP valuation store, IAM policy decision, or authority to commit a quote.
 *
 * Callers must obtain context from IAM/CP, cost from the authorised ERP/cost
 * provider, and margin policy from the trusted policy store before invocation.
 */
export type CommercialPricingContext = {
  tenantId: string
  sellerLegalEntityId: string
  marketId: string
  productId: string
  buyerOrganisationId: string
  currencyCode: string
}

export type CostBasisType =
  | "ACTUAL_LANDED"
  | "ESTIMATED_LANDED"
  | "WEIGHTED_AVERAGE"
  | "STANDARD"
  | "REPLACEMENT"

export type CommercialCostEvidence = {
  tenantId: string
  sellerLegalEntityId: string
  marketId: string
  productId: string
  currencyCode: string
  costBasisType: CostBasisType
  amountMinor: string
  sourceSystem: "ERP" | "GOVERNED_ESTIMATE"
  sourceReference: string
  version: string
  observedAt: string
  validUntil: string
}

export type CommercialMarginPolicy = {
  tenantId: string
  sellerLegalEntityId: string
  marketId: string
  productId: string
  buyerOrganisationId?: string
  policyReference: string
  version: string
  method: "GROSS_MARGIN" | "MARKUP"
  targetBasisPoints: number
  minimumBasisPoints: number
  belowMinimum: "BLOCK" | "REQUIRE_APPROVAL"
  validFrom: string
  validUntil: string
}

export type CommercialPriceSnapshot = {
  context: CommercialPricingContext
  costEvidence: CommercialCostEvidence
  policy: CommercialMarginPolicy
  resolvedAt: string
  targetPriceMinor: string
  floorPriceMinor: string
  quotedPriceMinor: string
  expectedMarginMinor: string
  state: "ELIGIBLE" | "REQUIRES_APPROVAL"
}

export type CommercialPriceResolution = {
  snapshot: CommercialPriceSnapshot
  fingerprint: string
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const MINOR = /^(?:0|[1-9][0-9]{0,23})$/
const MAX = 10n ** 24n - 1n
const BASIS = 10_000n

const deny = (reason: string): never => {
  throw new Error("ADR-0020 pricing refusal: " + reason)
}
const validId = (value: unknown): value is string =>
  typeof value === "string" && ID.test(value)
const validCurrency = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value)
const amount = (value: unknown, label: string): bigint => {
  if (typeof value !== "string" || !MINOR.test(value)) return deny(label + " is not exact minor-unit money")
  const parsed = BigInt(value)
  if (parsed > MAX) return deny(label + " exceeds supported precision")
  return parsed
}
const checked = (value: bigint, label: string): string => {
  if (value < -MAX || value > MAX) return deny(label + " exceeds supported precision")
  return value.toString()
}
const timestamp = (value: string, label: string): number => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    return deny(label + " must be an explicit UTC instant")
  const millis = Date.parse(value)
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== value.slice(0, 19))
    return deny(label + " is not a real UTC instant")
  return millis
}
const requireScope = (
  a: CommercialPricingContext,
  b: Pick<CommercialPricingContext, "tenantId" | "sellerLegalEntityId" | "marketId" | "productId">,
) => {
  for (const field of ["tenantId", "sellerLegalEntityId", "marketId", "productId"] as const) {
    if (!validId(a[field]) || !validId(b[field]) || a[field] !== b[field])
      deny("cost/policy scope mismatch: " + field)
  }
}
const bps = (value: unknown, method: CommercialMarginPolicy["method"], label: string): bigint => {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    return deny(label + " must be nonnegative integral basis points")
  if (method === "GROSS_MARGIN" && (value as number) >= 10_000)
    return deny("gross margin must be below 100 percent")
  if ((value as number) > 1_000_000)
    return deny(label + " exceeds configured limit")
  return BigInt(value as number)
}
const ceilDiv = (n: bigint, d: bigint): bigint => (n + d - 1n) / d
const priceAt = (cost: bigint, basisPoints: bigint, method: CommercialMarginPolicy["method"]) =>
  method === "GROSS_MARGIN"
    ? ceilDiv(cost * BASIS, BASIS - basisPoints)
    : ceilDiv(cost * (BASIS + basisPoints), BASIS)

/**
 * No FX guessing, no synthetic ERP cost, no inferred buyer authority, and no
 * implicit floor overrides. The optional offer is an internal pre-selected
 * contract/volume/customer price; it must pass the same cost/floor policy.
 */
export function resolveCommercialPrice(
  context: CommercialPricingContext,
  cost: CommercialCostEvidence,
  policy: CommercialMarginPolicy,
  now: string,
  offeredMinor?: string,
): CommercialPriceResolution {
  const at = timestamp(now, "decision time")
  if (!validId(context.buyerOrganisationId)) deny("buyer organisation is required")
  if (!validCurrency(context.currencyCode) || !validCurrency(cost.currencyCode) ||
      context.currencyCode !== cost.currencyCode) deny("cost/price FX or currency mismatch")
  requireScope(context, cost)
  requireScope(context, policy)
  if (policy.buyerOrganisationId !== undefined &&
      (!validId(policy.buyerOrganisationId) || policy.buyerOrganisationId !== context.buyerOrganisationId))
    deny("customer margin policy belongs to another buyer")
  for (const value of [cost.sourceReference, cost.version, policy.policyReference, policy.version])
    if (!validId(value)) deny("missing or invalid cost/policy provenance")
  if (!["ACTUAL_LANDED", "ESTIMATED_LANDED", "WEIGHTED_AVERAGE", "STANDARD", "REPLACEMENT"].includes(cost.costBasisType))
    deny("unknown cost-basis type")
  if (cost.sourceSystem !== "ERP" && cost.sourceSystem !== "GOVERNED_ESTIMATE")
    deny("unknown cost evidence source")
  if (cost.costBasisType !== "ESTIMATED_LANDED" && cost.costBasisType !== "REPLACEMENT" &&
      cost.sourceSystem !== "ERP") deny("actual/accounting cost must originate from ERP")
  if (cost.costBasisType === "ACTUAL_LANDED" && cost.sourceSystem !== "ERP")
    deny("estimated evidence cannot assert actual landed cost")
  const costObserved = timestamp(cost.observedAt, "cost observation")
  const costExpiry = timestamp(cost.validUntil, "cost expiry")
  if (costObserved > at || at >= costExpiry || costObserved >= costExpiry)
    deny("cost evidence is future-dated or stale")
  const policyStart = timestamp(policy.validFrom, "policy start")
  const policyExpiry = timestamp(policy.validUntil, "policy expiry")
  if (policyStart > at || at >= policyExpiry || policyStart >= policyExpiry)
    deny("margin policy is not effective")
  if (policy.method !== "GROSS_MARGIN" && policy.method !== "MARKUP")
    deny("margin method is unrecognised")
  if (policy.belowMinimum !== "BLOCK" && policy.belowMinimum !== "REQUIRE_APPROVAL")
    deny("below-floor action is unrecognised")

  const base = amount(cost.amountMinor, "cost")
  if (base === 0n) deny("zero-cost quotes require a separate governed policy")
  const targetBps = bps(policy.targetBasisPoints, policy.method, "target")
  const minimumBps = bps(policy.minimumBasisPoints, policy.method, "minimum")
  if (targetBps < minimumBps) deny("target is below approved margin floor")
  const target = priceAt(base, targetBps, policy.method)
  const floor = priceAt(base, minimumBps, policy.method)
  const quoted = offeredMinor === undefined ? target : amount(offeredMinor, "offer")
  if (quoted === 0n) deny("zero-price quote requires separate governed policy")
  const belowFloor = quoted < floor
  if (belowFloor && policy.belowMinimum === "BLOCK")
    deny("quote violates hard minimum commercial price")
  const snapshot: CommercialPriceSnapshot = {
    context: { ...context },
    costEvidence: { ...cost },
    policy: { ...policy },
    resolvedAt: now,
    targetPriceMinor: checked(target, "target"),
    floorPriceMinor: checked(floor, "floor"),
    quotedPriceMinor: checked(quoted, "quote"),
    expectedMarginMinor: checked(quoted - base, "expected margin"),
    state: belowFloor ? "REQUIRES_APPROVAL" : "ELIGIBLE",
  }
  return {
    snapshot,
    fingerprint: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
  }
}

/** Actual costs adjust realised margin; an issued customer price is never rewritten. */
export function reconcileActualMargin(
  snapshot: CommercialPriceSnapshot,
  actual: CommercialCostEvidence,
): { realisedMarginMinor: string; varianceFromExpectedMinor: string; actualCostReference: string } {
  requireScope(snapshot.context, actual)
  if (actual.currencyCode !== snapshot.context.currencyCode || !validCurrency(actual.currencyCode))
    deny("actual cost currency mismatch")
  if (actual.costBasisType !== "ACTUAL_LANDED" || actual.sourceSystem !== "ERP")
    deny("realised margin requires ERP actual landed cost")
  if (!validId(actual.sourceReference) || !validId(actual.version))
    deny("actual cost has no verifiable provenance")
  timestamp(actual.observedAt, "actual cost observation")
  timestamp(actual.validUntil, "actual cost expiry")
  const realised = amount(snapshot.quotedPriceMinor, "historical quote") -
    amount(actual.amountMinor, "actual cost")
  const expected = amount(snapshot.quotedPriceMinor, "historical quote") -
    amount(snapshot.costEvidence.amountMinor, "historical cost")
  return {
    realisedMarginMinor: checked(realised, "realised margin"),
    varianceFromExpectedMinor: checked(realised - expected, "margin variance"),
    actualCostReference: actual.sourceReference,
  }
}
