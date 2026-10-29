import { createHash, randomUUID } from "node:crypto"

/** Trade v1 commercial resources, distinct from standalone rfq/v1 resources.
 * This kernel owns no authentication or accounting authority. The transactional
 * service must obtain current operation authority before calling it.
 */
export type CommercialContext = {
  principal_id: string
  tenant_id: string
  legal_entity_id: string
  digital_estate_id: string
  market_id: string
  buyer_organisation_id: string
}
export type Quantity = { value: string; unit: string }
export type Money = { amount: string; currency: string }
export type RfqLine = { client_line_id: string; variant_id: string; quantity: Quantity }
export type RfqInput = {
  context: CommercialContext
  reference?: string
  notes?: string
  requested_delivery_date?: string
  requested_incoterm?: string
  lines: RfqLine[]
}
export type RfqStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "QUOTED"
  | "DECLINED"
  | "WITHDRAWN"
  | "EXPIRED"
  | "CLOSED"
export type Rfq = RfqInput & {
  rfq_id: string
  status: RfqStatus
  version: number
  created_at: string
  updated_at: string
}
export type QuotationLine = {
  line_id: string
  variant_id: string
  quantity: Quantity
  unit_price: Money
  line_total: Money
}
export type QuotationInput = {
  currency: string
  lines: QuotationLine[]
  total: Money
  incoterm?: string
  payment_terms?: string
  valid_until: string
}
export type Quotation = QuotationInput & {
  quotation_id: string
  rfq_id: string
  context: CommercialContext
  status: "DRAFT" | "ISSUED" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | "EXPIRED" | "CONVERTED"
  version: number
  created_at: string
  updated_at: string
}
export type CommercialResource = Rfq | Quotation
export class CommercialRefusal extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "NOT_FOUND"
      | "CONFLICT"
      | "AUTHORITY_UNAVAILABLE"
      | "AUTHORITY_DENIED"
      | "COMMITMENT_NOT_QUALIFIED",
  ) {
    super(code)
  }
}
export const refuseCommercial = (code: CommercialRefusal["code"]): never => {
  throw new CommercialRefusal(code)
}
const invalid = () => refuseCommercial("INVALID_REQUEST")
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const CURRENCY = /^[A-Z]{3}$/
const CONTEXT_FIELDS = [
  "principal_id",
  "tenant_id",
  "legal_entity_id",
  "digital_estate_id",
  "market_id",
  "buyer_organisation_id",
] as const
export const object = (
  value: unknown,
  allowed: readonly string[],
  required = allowed,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid()
  const row = value as Record<string, unknown>
  if (
    Object.keys(row).some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(row, key))
  )
    return invalid()
  return row
}
const text = (value: unknown, max: number, pattern?: RegExp): string => {
  if (typeof value !== "string" || value.length > max || (pattern && !pattern.test(value)))
    return invalid()
  return value
}
export const commercialContext = (value: unknown): CommercialContext => {
  const row = object(value, CONTEXT_FIELDS)
  for (const key of CONTEXT_FIELDS) text(row[key], 128, ID)
  return structuredClone(row) as CommercialContext
}
/** Principal identifies the initiating actor, not ownership of the company resource. */
export const sameCommercialScope = (a: CommercialContext, b: CommercialContext) =>
  CONTEXT_FIELDS.filter((key) => key !== "principal_id").every((key) => a[key] === b[key])

const decimal = (value: unknown, positive = false): string => {
  const result = text(value, 64, DECIMAL)
  if (positive && !/[1-9]/.test(result)) return invalid()
  return result
}
const quantity = (value: unknown): Quantity => {
  const row = object(value, ["value", "unit"])
  return { value: decimal(row.value, true), unit: text(row.unit, 24, /^[A-Z0-9][A-Z0-9._/-]*$/) }
}
const money = (value: unknown, currency: string): Money => {
  const row = object(value, ["amount", "currency"])
  if (row.currency !== currency) return invalid()
  return { amount: decimal(row.amount), currency }
}
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return invalid()
  return value
}
const unique = (ids: string[]) => {
  if (new Set(ids).size !== ids.length) invalid()
}
/** BigInt scaled decimal arithmetic; never JSON float arithmetic or implicit rounding. */
const scaled = (s: string): { n: bigint; scale: number } => ({
  n: BigInt(s.replace(".", "")),
  scale: s.includes(".") ? s.length - s.indexOf(".") - 1 : 0,
})
const equalDecimal = (a: { n: bigint; scale: number }, b: { n: bigint; scale: number }) =>
  a.n * 10n ** BigInt(b.scale) === b.n * 10n ** BigInt(a.scale)
const timestamp = (value: unknown): string => {
  const raw = text(value, 40, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  const parsed = new Date(raw)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== raw.slice(0, 19))
    return invalid()
  return parsed.toISOString()
}
const instant = (now: Date): string => {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return invalid()
  return now.toISOString()
}
const id = (prefix: string) => prefix + randomUUID().replaceAll("-", "")
export function createRfq(value: unknown, resolved: CommercialContext, now: Date): Rfq {
  const row = object(
    value,
    ["context", "reference", "notes", "requested_delivery_date", "requested_incoterm", "lines"],
    ["context", "lines"],
  )
  const context = commercialContext(row.context)
  if (!sameCommercialScope(context, resolved) || context.principal_id !== resolved.principal_id)
    return refuseCommercial("AUTHORITY_DENIED")
  const lines = array(row.lines).map((value): RfqLine => {
    const line = object(value, ["client_line_id", "variant_id", "quantity"])
    return {
      client_line_id: text(line.client_line_id, 128, ID),
      variant_id: text(line.variant_id, 128, ID),
      quantity: quantity(line.quantity),
    }
  })
  unique(lines.map((line) => line.client_line_id))
  const result: Rfq = {
    context,
    lines,
    rfq_id: id("rfq_"),
    status: "DRAFT",
    version: 1,
    created_at: instant(now),
    updated_at: instant(now),
  }
  if (row.reference !== undefined) result.reference = text(row.reference, 120)
  if (row.notes !== undefined) result.notes = text(row.notes, 4000)
  if (row.requested_incoterm !== undefined)
    result.requested_incoterm = text(row.requested_incoterm, 3, /^[A-Z]{3}$/)
  if (row.requested_delivery_date !== undefined) {
    const date = text(row.requested_delivery_date, 10, /^\d{4}-\d{2}-\d{2}$/)
    if (timestamp(date + "T00:00:00Z").slice(0, 10) !== date) return invalid()
    result.requested_delivery_date = date
  }
  return result
}
export function transitionRfq(current: Rfq, next: RfqStatus, version: number, now: Date): Rfq {
  const transitions: Record<RfqStatus, readonly RfqStatus[]> = {
    DRAFT: ["SUBMITTED", "WITHDRAWN"],
    SUBMITTED: ["UNDER_REVIEW", "DECLINED", "WITHDRAWN", "EXPIRED"],
    UNDER_REVIEW: ["QUOTED", "DECLINED", "WITHDRAWN", "EXPIRED"],
    QUOTED: ["UNDER_REVIEW", "CLOSED", "WITHDRAWN", "EXPIRED"],
    DECLINED: [],
    WITHDRAWN: [],
    EXPIRED: [],
    CLOSED: [],
  }
  if (
    !Number.isSafeInteger(version) ||
    version !== current.version ||
    !transitions[current.status].includes(next) ||
    now.getTime() < Date.parse(current.updated_at)
  )
    return refuseCommercial("CONFLICT")
  return {
    ...structuredClone(current),
    status: next,
    version: version + 1,
    updated_at: instant(now),
  }
}
export function issueQuotation(value: unknown, rfq: Rfq, now: Date): Quotation {
  if (rfq.status !== "UNDER_REVIEW") return refuseCommercial("CONFLICT")
  const row = object(
    value,
    ["currency", "lines", "total", "incoterm", "payment_terms", "valid_until"],
    ["currency", "lines", "total", "valid_until"],
  )
  const currency = text(row.currency, 3, CURRENCY)
  const lines = array(row.lines).map((value): QuotationLine => {
    const line = object(value, ["line_id", "variant_id", "quantity", "unit_price", "line_total"])
    const result = {
      line_id: text(line.line_id, 128, ID),
      variant_id: text(line.variant_id, 128, ID),
      quantity: quantity(line.quantity),
      unit_price: money(line.unit_price, currency),
      line_total: money(line.line_total, currency),
    }
    const q = scaled(result.quantity.value),
      p = scaled(result.unit_price.amount)
    if (!equalDecimal({ n: q.n * p.n, scale: q.scale + p.scale }, scaled(result.line_total.amount)))
      return invalid()
    if (
      !rfq.lines.some(
        (offered) =>
          offered.variant_id === result.variant_id &&
          offered.quantity.unit === result.quantity.unit,
      )
    )
      return invalid()
    return result
  })
  unique(lines.map((line) => line.line_id))
  const total = money(row.total, currency)
  const sums = lines.map((line) => scaled(line.line_total.amount))
  const scale = Math.max(...sums.map((part) => part.scale))
  if (
    !equalDecimal(
      {
        n: sums.reduce((sum, part) => sum + part.n * 10n ** BigInt(scale - part.scale), 0n),
        scale,
      },
      scaled(total.amount),
    )
  )
    return invalid()
  const valid = timestamp(row.valid_until)
  if (Date.parse(valid) <= now.getTime()) return invalid()
  const result: Quotation = {
    currency,
    lines,
    total,
    valid_until: valid,
    quotation_id: id("quote_"),
    rfq_id: rfq.rfq_id,
    context: structuredClone(rfq.context),
    status: "ISSUED",
    version: 1,
    created_at: instant(now),
    updated_at: instant(now),
  }
  if (row.incoterm !== undefined) result.incoterm = text(row.incoterm, 3, /^[A-Z]{3}$/)
  if (row.payment_terms !== undefined) result.payment_terms = text(row.payment_terms, 500)
  return result
}
export function transitionQuotation(
  current: Quotation,
  next: Quotation["status"],
  version: number,
  now: Date,
): Quotation {
  // Binding acceptance/conversion belongs to the native receipt/reservation
  // composition. No flag, callback or this kernel's generic transition enables it.
  if (next === "ACCEPTED" || next === "CONVERTED")
    return refuseCommercial("COMMITMENT_NOT_QUALIFIED")
  if (
    !Number.isSafeInteger(version) ||
    current.version !== version ||
    current.status !== "ISSUED" ||
    !["REJECTED", "WITHDRAWN", "EXPIRED"].includes(next) ||
    now.getTime() < Date.parse(current.updated_at)
  )
    return refuseCommercial("CONFLICT")
  if (
    next === "EXPIRED"
      ? now.getTime() < Date.parse(current.valid_until)
      : now.getTime() >= Date.parse(current.valid_until)
  )
    return refuseCommercial("CONFLICT")
  return {
    ...structuredClone(current),
    status: next,
    version: version + 1,
    updated_at: instant(now),
  }
}
/** Canonical digests preserve exact decimal strings and ignore object key order. */
export function commercialDigest(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v)
    if (typeof v === "number" && Number.isSafeInteger(v)) return JSON.stringify(v)
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]"
    if (typeof v === "object" && v !== null)
      return (
        "{" +
        Object.keys(v)
          .sort()
          .map((key) => JSON.stringify(key) + ":" + canonical((v as Record<string, unknown>)[key]))
          .join(",") +
        "}"
      )
    return invalid()
  }
  return "sha256:" + createHash("sha256").update(canonical(value)).digest("hex")
}
