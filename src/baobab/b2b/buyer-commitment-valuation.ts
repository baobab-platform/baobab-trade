import { createHash, randomUUID } from "node:crypto"

/**
 * ADR-SHARED-042 Decision 7 — buyer obligation, not payment tender.
 *
 * This is a pure server-side semantic kernel over externally verified native
 * Medusa facts; it is NOT a native pricing provider, IAM/CP permission, new
 * checkout route or a buyer-authority receipt issuer. A future owner adapter
 * MUST supply only final native pricing/tax/shipping facts of the *same*
 * immutable order version and independently re-read them at order COMMIT.
 * No mutable browser cart total or user-submitted value is authoritative.
 *
 * Matches accepted Shared #430:
 * contracts/trade/v2/buyer-commitment-valuation.schema.json
 * scripts/tests/test_buyer_commitment_valuation.py (canonical binding hash).
 */
export const COMPONENT_KINDS = [
  "MERCHANDISE",
  "ITEM_DISCOUNT",
  "ORDER_DISCOUNT",
  "SHIPPING",
  "HANDLING",
  "INSURANCE",
  "SERVICE_CHARGE",
  "TAX",
  "DUTY_AND_IMPORT_CHARGE",
  "REFUNDABLE_DEPOSIT",
] as const

export type ComponentKind = (typeof COMPONENT_KINDS)[number]

export type FinalNativeComponent = {
  component_kind: ComponentKind
  amount_minor: number
  determination: "FINAL"
  source_reference: string
}

export type FinalNativeValuationFacts = {
  resource_id: string
  resource_version: number
  transaction_digest: string
  currency: string
  basis: "FINAL_PRICED"
  components: FinalNativeComponent[]
}

export type BuyerCommitmentValuation = FinalNativeValuationFacts & {
  valuation_id: string
  buyer_commitment_amount_minor: number
  valued_at: string
  valuation_digest: string
}

export type ValuationRefusalCode =
  | "VALUATION_INVALID"
  | "VALUATION_NOT_FINAL"
  | "VALUATION_UNSAFE_AMOUNT"
  | "VALUATION_MERCHANDISE_REQUIRED"
  | "VALUATION_DUPLICATE_NATIVE_FACT"
  | "VALUATION_INVALID_CHARGE_SIGN"

export class ValuationRefusal extends Error {
  constructor(readonly code: ValuationRefusalCode) {
    super(code)
    this.name = "ValuationRefusal"
  }
}

const SHA256 = /^sha256:[0-9a-f]{64}$/
const CUR = /^[A-Z]{3}$/
const PRINTABLE = /^[\x21-\x7e]{1,200}$/
const KINDS = new Set<string>(COMPONENT_KINDS)
const DISCOUNTS = new Set<string>(["ITEM_DISCOUNT", "ORDER_DISCOUNT"])
const TOP_FIELDS = new Set([
  "resource_id", "resource_version", "transaction_digest",
  "currency", "basis", "components",
])
const COMPONENT_FIELDS = new Set([
  "component_kind", "amount_minor", "determination", "source_reference",
])

function refuse(code: ValuationRefusalCode): never {
  throw new ValuationRefusal(code)
}

function closed(value: unknown, allowed: Set<string>): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.has(key))
  )
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** JSON canonical keys sorted recursively; never use locale-dependent order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value !== "object" || value === null) return value
  const object = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(object)
      .sort(cmp)
      .map((key) => [key, sortKeys(object[key])]),
  )
}

/**
 * Same binding hash as Shared's Python 3.14 reference, including explicit
 * null maximum_commitment_reference and independent sorted components.
 * Generated valuation ID/timestamp are NOT security-critical hash inputs.
 */
export function valuationDigest(
  facts: Pick<
    BuyerCommitmentValuation,
    | "resource_id"
    | "resource_version"
    | "transaction_digest"
    | "currency"
    | "basis"
    | "components"
    | "buyer_commitment_amount_minor"
  >,
): string {
  const components = [...facts.components]
    .sort(
      (a, b) =>
        cmp(a.component_kind, b.component_kind) ||
        cmp(a.source_reference, b.source_reference),
    )
    .map((c) => ({
      component_kind: c.component_kind,
      amount_minor: c.amount_minor,
      determination: c.determination,
      source_reference: c.source_reference,
    }))
  const binding = sortKeys({
    basis: facts.basis,
    buyer_commitment_amount_minor: facts.buyer_commitment_amount_minor,
    components,
    currency: facts.currency,
    maximum_commitment_reference: null,
    resource_id: facts.resource_id,
    resource_version: facts.resource_version,
    transaction_digest: facts.transaction_digest,
  })
  return "sha256:" + createHash("sha256").update(JSON.stringify(binding), "utf8").digest("hex")
}

/**
 * Reject all unknown, estimated, ambiguous and tender facts. Uses BigInt for
 * accumulation so a floating-point overflow can never round up an approval
 * or silently reduce a spend limit.
 *
 * Caller-supplied facts, even when well formed, are NOT a CP IAM authorization
 * and MUST NOT be passed to a live order without a trusted native readback.
 */
export function buildFinalBuyerCommitmentValuation(
  candidate: unknown,
  now: Date = new Date(),
): BuyerCommitmentValuation {
  if (
    !closed(candidate, TOP_FIELDS) ||
    Object.keys(candidate).length !== TOP_FIELDS.size ||
    typeof candidate.resource_id !== "string" ||
    candidate.resource_id.length < 1 ||
    candidate.resource_id.length > 128 ||
    !Number.isSafeInteger(candidate.resource_version) ||
    (candidate.resource_version as number) < 1 ||
    typeof candidate.transaction_digest !== "string" ||
    !SHA256.test(candidate.transaction_digest) ||
    typeof candidate.currency !== "string" ||
    !CUR.test(candidate.currency) ||
    candidate.basis !== "FINAL_PRICED" ||
    !Array.isArray(candidate.components) ||
    candidate.components.length < 1 ||
    candidate.components.length > 500 ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) {
    return refuse("VALUATION_INVALID")
  }

  const components: FinalNativeComponent[] = []
  const seen = new Set<string>()
  let sum = 0n
  let hasMerchandise = false
  for (const item of candidate.components) {
    if (
      !closed(item, COMPONENT_FIELDS) ||
      Object.keys(item).length !== COMPONENT_FIELDS.size ||
      typeof item.component_kind !== "string" ||
      !KINDS.has(item.component_kind) ||
      typeof item.source_reference !== "string" ||
      !PRINTABLE.test(item.source_reference)
    ) {
      return refuse("VALUATION_INVALID")
    }
    if (item.determination !== "FINAL") return refuse("VALUATION_NOT_FINAL")
    if (!Number.isSafeInteger(item.amount_minor)) return refuse("VALUATION_UNSAFE_AMOUNT")
    if (
      (DISCOUNTS.has(item.component_kind) && (item.amount_minor as number) > 0) ||
      (!DISCOUNTS.has(item.component_kind) && (item.amount_minor as number) < 0)
    )
      return refuse("VALUATION_INVALID_CHARGE_SIGN")
    const pair = item.component_kind + "\u0000" + item.source_reference
    if (seen.has(pair)) return refuse("VALUATION_DUPLICATE_NATIVE_FACT")
    seen.add(pair)
    if (item.component_kind === "MERCHANDISE") hasMerchandise = true
    sum += BigInt(item.amount_minor as number)
    if (sum > BigInt(Number.MAX_SAFE_INTEGER) || sum < BigInt(Number.MIN_SAFE_INTEGER))
      return refuse("VALUATION_UNSAFE_AMOUNT")
    components.push({
      component_kind: item.component_kind as ComponentKind,
      amount_minor: item.amount_minor as number,
      determination: "FINAL",
      source_reference: item.source_reference,
    })
  }

  if (!hasMerchandise) return refuse("VALUATION_MERCHANDISE_REQUIRED")
  if (sum <= 0n || sum > BigInt(Number.MAX_SAFE_INTEGER))
    return refuse("VALUATION_UNSAFE_AMOUNT")
  const ordered = components.sort(
    (a, b) =>
      cmp(a.component_kind, b.component_kind) ||
      cmp(a.source_reference, b.source_reference),
  )
  const facts: FinalNativeValuationFacts = {
    resource_id: candidate.resource_id as string,
    resource_version: candidate.resource_version as number,
    transaction_digest: candidate.transaction_digest as string,
    currency: candidate.currency as string,
    basis: "FINAL_PRICED",
    components: ordered,
  }
  const total = Number(sum)
  return {
    valuation_id: randomUUID(),
    ...facts,
    buyer_commitment_amount_minor: total,
    valued_at: now.toISOString(),
    valuation_digest: valuationDigest({ ...facts, buyer_commitment_amount_minor: total }),
  }
}
