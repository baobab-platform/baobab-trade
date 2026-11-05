import { createHash } from "node:crypto"
import type { PgClient } from "../orders/postgres-governed-binding-persistence"
import type { FinalNativeValuationFacts, FinalNativeComponent, ComponentKind } from "./buyer-commitment-valuation"

/**
 * CAA-06b authoritative full-cart price reader. This is NOT a new checkout
 * route, an authority decision or a tax/duty calculator.
 *
 * The Medusa Cart Module computes totals; the cart table does not store them.
 * Both the native rows and the computed Cart Module result must be read with
 * the Order Module's existing transaction manager. Every applicable extra
 * charge, including a justified zero, comes from an explicit immutable
 * scoped determination. A missing determination is never an implicit zero.
 */
type Query = Pick<PgClient, "query">
export type NativeCartModule = {
  retrieveCart(id: string, config: { select: string[]; relations: string[] }, context: unknown): Promise<unknown>
}
export type NativeCartPriceScope = {
  db: Query
  transactionManager: unknown
  cartModule: NativeCartModule
  cartId: string
  tenantId: string
  marketId: string
  sellerLegalEntityId: string
  /** Must be resolved from governed native currency metadata, not inferred. */
  currencyExponent: number
  now?: Date
}
export type NativeFinalCartPrice = {
  valuation: FinalNativeValuationFacts
  /** Includes native rows, amounts, explicit zero reasons and source versions. */
  sourceFingerprint: string
}
type RecordValue = Record<string, unknown>
type ChargeKind =
  | "TAX" | "FREIGHT" | "DUTY" | "HANDLING" | "INSURANCE"
  | "SERVICE_CHARGE" | "REFUNDABLE_DEPOSIT"
const CHARGES: readonly ChargeKind[] = [
  "TAX", "FREIGHT", "DUTY", "HANDLING", "INSURANCE",
  "SERVICE_CHARGE", "REFUNDABLE_DEPOSIT",
]
const DETERMINED = new Set(["CHARGED", "ZERO_RATED", "EXEMPT", "NOT_APPLICABLE"])
const MONEY = /^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const REF = /^[\x21-\x7e]{8,200}$/
function refuse(code: string): never { throw new Error("NATIVE_FINAL_CART_" + code) }
function object(v: unknown): RecordValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) return refuse("SOURCE_INCOMPLETE")
  return v as RecordValue
}
function text(v: unknown): string {
  if (typeof v !== "string" || !v) return refuse("SOURCE_INCOMPLETE")
  return v
}
function money(v: unknown, exponent: number): number {
  // Medusa BigNumber objects expose numeric; never use .toNumber(), Math.round,
  // parseFloat, or infer a missing amount as zero.
  const raw = typeof v === "object" && v !== null
    ? (v as RecordValue).numeric
    : v
  if (typeof raw !== "string" && !(typeof raw === "number" && Number.isSafeInteger(raw))) {
    return refuse("AMOUNT_UNAVAILABLE")
  }
  const amount = String(raw)
  if (!MONEY.test(amount) || amount.length > 30) return refuse("AMOUNT_UNAVAILABLE")
  const [whole, frac = ""] = amount.split(".")
  if (frac.length > exponent && /[1-9]/.test(frac.slice(exponent))) {
    return refuse("CURRENCY_PRECISION_INVALID")
  }
  const value = BigInt(whole) * 10n ** BigInt(exponent) +
    BigInt(frac.slice(0, exponent).padEnd(exponent, "0") || "0")
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return refuse("AMOUNT_UNSAFE")
  return Number(value)
}
function numericMinor(v: unknown): number {
  const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : v
  if (typeof s !== "string" || !/^(0|[1-9][0-9]*)$/.test(s)) {
    return refuse("DETERMINATION_INVALID")
  }
  const value = BigInt(s)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return refuse("AMOUNT_UNSAFE")
  return Number(value)
}
function date(v: unknown): number {
  const t = typeof v === "string" || v instanceof Date ? Date.parse(String(v)) : NaN
  if (!Number.isSafeInteger(t) || t <= 0) return refuse("SOURCE_VERSION_UNAVAILABLE")
  return t
}
function stableHash(value: unknown): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
function ordered(v: unknown): RecordValue[] {
  if (!Array.isArray(v)) return refuse("SOURCE_INCOMPLETE")
  const result = v.map(object)
  result.sort((a, b) => text(a.id) < text(b.id) ? -1 : text(a.id) > text(b.id) ? 1 : 0)
  if (new Set(result.map((row) => row.id)).size !== result.length) {
    return refuse("DUPLICATE_NATIVE_LINE")
  }
  return result
}
function component(kind: ComponentKind, amount: number, reference: string): FinalNativeComponent {
  if (!REF.test(reference) || !Number.isSafeInteger(amount)) return refuse("DETERMINATION_INVALID")
  return { component_kind: kind, amount_minor: amount, determination: "FINAL", source_reference: reference }
}

/**
 * This explicit lock set is deliberately not a cart-row-only read.
 * FOR UPDATE on the cart blocks new FK-backed items/methods; locks on the
 * existing children block changes and insertion of linked tax/adjustment rows
 * before native order COMMIT. Any unreviewed Medusa schema change fails closed.
 */
async function lockNativeCart(db: Query, cartId: string): Promise<{
  currency: string; updatedAt: number; customerId: string
}> {
  const cart = await db.query(
    "SELECT id,currency_code,customer_id,completed_at,updated_at FROM cart " +
    "WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [cartId])
  if (cart.rows.length !== 1 || cart.rows[0].completed_at !== null) return refuse("CART_NOT_OPEN")
  const currency = text(cart.rows[0].currency_code).toUpperCase()
  const customerId = text(cart.rows[0].customer_id)
  if (!/^[A-Z]{3}$/.test(currency)) return refuse("CURRENCY_INVALID")
  const updatedAt = date(cart.rows[0].updated_at)
  const items = await db.query(
    "SELECT id FROM cart_line_item WHERE cart_id=$1 AND deleted_at IS NULL FOR UPDATE", [cartId])
  if (!items.rows.length || items.rows.length > 250) return refuse("ITEMS_UNAVAILABLE")
  const methods = await db.query(
    "SELECT id FROM cart_shipping_method WHERE cart_id=$1 AND deleted_at IS NULL FOR UPDATE", [cartId])
  if (methods.rows.length > 50) return refuse("SHIPPING_UNAVAILABLE")
  for (const [table, field, ids] of [
    ["cart_line_item_tax_line", "item_id", items.rows.map((r) => r.id)],
    ["cart_line_item_adjustment", "item_id", items.rows.map((r) => r.id)],
    ["cart_shipping_method_tax_line", "shipping_method_id", methods.rows.map((r) => r.id)],
    ["cart_shipping_method_adjustment", "shipping_method_id", methods.rows.map((r) => r.id)],
  ] as const) {
    if (ids.length) {
      await db.query("SELECT id FROM " + table + " WHERE " + field +
        "=ANY($1::text[]) AND deleted_at IS NULL FOR UPDATE", [ids])
    }
  }
  return { currency, updatedAt, customerId }
}

function assertSameIds(actual: RecordValue[], native: RecordValue[], code: string): void {
  const a = actual.map((r) => text(r.id)).sort()
  const b = native.map((r) => text(r.id)).sort()
  if (JSON.stringify(a) !== JSON.stringify(b)) refuse(code)
}

export async function readMedusaFinalCartPrice(scope: NativeCartPriceScope): Promise<NativeFinalCartPrice> {
  const now = scope.now ?? new Date()
  if (!Number.isSafeInteger(scope.currencyExponent) ||
      scope.currencyExponent < 0 || scope.currencyExponent > 9 ||
      !Number.isFinite(now.getTime()) ||
      !scope.transactionManager || !scope.cartModule ||
      typeof scope.cartModule.retrieveCart !== "function") return refuse("READER_UNAVAILABLE")
  const locked = await lockNativeCart(scope.db, scope.cartId)
  const nativeItems = await scope.db.query(
    "SELECT id FROM cart_line_item WHERE cart_id=$1 AND deleted_at IS NULL FOR SHARE", [scope.cartId])
  const nativeShipping = await scope.db.query(
    "SELECT id FROM cart_shipping_method WHERE cart_id=$1 AND deleted_at IS NULL FOR SHARE", [scope.cartId])
  const cart = object(await scope.cartModule.retrieveCart(
    scope.cartId,
    {
      select: [
        "id", "customer_id", "currency_code", "updated_at", "completed_at",
        "item_subtotal", "shipping_subtotal", "subtotal", "discount_subtotal",
        "tax_total", "item_tax_total", "shipping_tax_total",
        "total", "credit_line_total", "gift_card_total",
      ],
      relations: [
        "items", "items.tax_lines", "items.adjustments",
        "shipping_methods", "shipping_methods.tax_lines", "shipping_methods.adjustments",
      ],
    },
    { transactionManager: scope.transactionManager },
  ))
  if (cart.id !== scope.cartId ||
      text(cart.currency_code).toUpperCase() !== locked.currency ||
      cart.customer_id !== locked.customerId ||
      cart.completed_at !== null ||
      date(cart.updated_at) !== locked.updatedAt) return refuse("NATIVE_CART_CHANGED")
  const items = ordered(cart.items)
  const shipping = ordered(cart.shipping_methods)
  assertSameIds(items, nativeItems.rows, "ITEM_SET_CHANGED")
  assertSameIds(shipping, nativeShipping.rows, "SHIPPING_SET_CHANGED")
  const e = scope.currencyExponent
  const merchandise = money(cart.item_subtotal, e)
  const freight = money(cart.shipping_subtotal, e)
  const discount = money(cart.discount_subtotal, e)
  const tax = money(cart.tax_total, e)
  const nativeTotal = money(cart.total, e)
  if (money(cart.subtotal, e) !== merchandise + freight ||
      money(cart.item_tax_total, e) + money(cart.shipping_tax_total, e) !== tax ||
      money(cart.credit_line_total, e) !== 0 || money(cart.gift_card_total, e) !== 0 ||
      BigInt(nativeTotal) !== BigInt(merchandise) + BigInt(freight) +
        BigInt(tax) - BigInt(discount)) return refuse("NATIVE_TOTALS_INCONSISTENT")
  const lineComponents: FinalNativeComponent[] = []
  const lineFingerprint: unknown[] = []
  let itemSum = 0n
  for (const item of items) {
    const id = text(item.id)
    const qty = item.quantity
    if (!Number.isSafeInteger(qty) || (qty as number) <= 0 || !text(item.variant_id)) {
      return refuse("ITEM_SOURCE_INCOMPLETE")
    }
    const unit = money(item.unit_price, e)
    const subtotal = money(item.subtotal, e)
    if (BigInt(unit) * BigInt(qty as number) !== BigInt(subtotal)) {
      return refuse("ITEM_SUBTOTAL_INCONSISTENT")
    }
    itemSum += BigInt(subtotal)
    lineComponents.push(component("MERCHANDISE", subtotal, "native:cart-item:" + id))
    lineFingerprint.push([id, item.variant_id, qty, unit, subtotal])
  }
  if (itemSum !== BigInt(merchandise)) return refuse("ITEM_TOTAL_CHANGED")
  let shippingSum = 0n
  const shippingFingerprint: unknown[] = []
  for (const method of shipping) {
    const amount = money(method.subtotal, e)
    shippingSum += BigInt(amount)
    shippingFingerprint.push([text(method.id), amount])
  }
  if (shippingSum !== BigInt(freight)) return refuse("FREIGHT_TOTAL_CHANGED")

  // All seven classes have explicit signed/approved-source provenance and a
  // current validity interval. No missing row (even duty=0) is acceptable.
  const evidence = await scope.db.query(
    "SELECT charge_kind,resolution,amount_minor,currency,source_reference," +
    "evaluated_at,expires_at,resource_version FROM trade_native_cart_charge_determination " +
    "WHERE tenant_id=$1 AND cart_id=$2 AND market_id=$3 AND seller_legal_entity_id=$4 " +
    "AND resource_version=$5 FOR SHARE",
    [scope.tenantId, scope.cartId, scope.marketId, scope.sellerLegalEntityId, locked.updatedAt])
  if (evidence.rows.length !== CHARGES.length) return refuse("CHARGE_DETERMINATION_MISSING")
  const proofs: unknown[] = []
  const cost: Partial<Record<ChargeKind, number>> = {}
  const references: Partial<Record<ChargeKind, string>> = {}
  for (const row of evidence.rows) {
    if (!CHARGES.includes(row.charge_kind as ChargeKind) ||
        cost[row.charge_kind as ChargeKind] !== undefined ||
        !DETERMINED.has(String(row.resolution)) ||
        row.currency !== locked.currency ||
        Number(row.resource_version) !== locked.updatedAt ||
        date(row.evaluated_at) > now.getTime() ||
        date(row.expires_at) <= now.getTime() ||
        typeof row.source_reference !== "string" || !REF.test(row.source_reference)) {
      return refuse("CHARGE_DETERMINATION_INVALID")
    }
    const value = numericMinor(row.amount_minor)
    if ((row.resolution === "CHARGED" && value === 0) ||
        (row.resolution !== "CHARGED" && value !== 0)) {
      return refuse("UNJUSTIFIED_ZERO_OR_CHARGE")
    }
    const kind = row.charge_kind as ChargeKind
    cost[kind] = value
    references[kind] = row.source_reference
    proofs.push([kind, row.resolution, value, row.source_reference, date(row.expires_at)])
  }
  if (!CHARGES.every((kind) => cost[kind] !== undefined)) {
    return refuse("CHARGE_DETERMINATION_MISSING")
  }
  if (cost.TAX !== tax || cost.FREIGHT !== freight) {
    return refuse("TAX_OR_FREIGHT_MISMATCH")
  }
  proofs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"))
  const components = [
    ...lineComponents,
    component("ORDER_DISCOUNT", -discount, "native:cart-discount:" + scope.cartId),
    component("SHIPPING", freight, references.FREIGHT!),
    component("TAX", tax, references.TAX!),
    component("DUTY_AND_IMPORT_CHARGE", cost.DUTY!, references.DUTY!),
    component("HANDLING", cost.HANDLING!, references.HANDLING!),
    component("INSURANCE", cost.INSURANCE!, references.INSURANCE!),
    component("SERVICE_CHARGE", cost.SERVICE_CHARGE!, references.SERVICE_CHARGE!),
    component("REFUNDABLE_DEPOSIT", cost.REFUNDABLE_DEPOSIT!, references.REFUNDABLE_DEPOSIT!),
  ]
  const fingerprint = stableHash({
    id: scope.cartId, updated_at: locked.updatedAt, customer: locked.customerId,
    tenant: scope.tenantId, market: scope.marketId, seller: scope.sellerLegalEntityId,
    currency: locked.currency, lineFingerprint, shippingFingerprint,
    merchandise, freight, discount, tax, nativeTotal, proofs,
  })
  return {
    valuation: {
      resource_id: scope.cartId,
      resource_version: locked.updatedAt,
      transaction_digest: fingerprint,
      currency: locked.currency,
      basis: "FINAL_PRICED",
      components,
    },
    sourceFingerprint: fingerprint,
  }
}
