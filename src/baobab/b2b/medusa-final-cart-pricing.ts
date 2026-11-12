import { createHash, createPublicKey, verify } from "node:crypto"
import { signedChargeBytes, type ChargeEvidence } from "./governed-cart-charge-issuer"
import type { PgClient } from "../orders/postgres-governed-binding-persistence"
import type {
  FinalNativeValuationFacts,
  FinalNativeComponent,
  ComponentKind,
} from "./buyer-commitment-valuation"

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
  retrieveCart(
    id: string,
    config: { select: string[]; relations: string[] },
    context: unknown,
  ): Promise<unknown>
}
export type NativePriceIssuerCheck = {
  tenantId: string
  cartId: string
  marketId: string
  sellerLegalEntityId: string
  currency: string
  issuerId: string
  decisionId: string
  policyReference: string
  sourceDigest: string
}
export type NativePriceIssuerDecision = {
  outcome: "AUTHORIZED" | "DENIED" | "UNAVAILABLE"
  issuerId: string
  decisionId: string
  tenantId: string
  marketId: string
  sellerLegalEntityId: string
  policyReference: string
  sourceDigest: string
  expiresAt: string
}
export type CurrentPriceIssuerAuthority = (
  check: NativePriceIssuerCheck,
) => Promise<NativePriceIssuerDecision>

/** Current CP price-issuer authority readback must be called on BOTH
 * pre-order and pre-commit cart reads. A historical issuer receipt alone
 * is insufficient after revocation. It never computes tax/freight/duty.
 */
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
  verifyCurrentIssuer: CurrentPriceIssuerAuthority
  now?: Date
}
export type NativeFinalCartPrice = {
  valuation: FinalNativeValuationFacts
  /** Includes native rows, amounts, explicit zero reasons and source versions. */
  sourceFingerprint: string
  /** Earliest signed charge or live CP issuer expiry, in epoch milliseconds. */
  leaseExpiresAt: number
}
type RecordValue = Record<string, unknown>
type ChargeKind =
  "TAX" | "FREIGHT" | "DUTY" | "HANDLING" | "INSURANCE" | "SERVICE_CHARGE" | "REFUNDABLE_DEPOSIT"
const CHARGES: readonly ChargeKind[] = [
  "TAX",
  "FREIGHT",
  "DUTY",
  "HANDLING",
  "INSURANCE",
  "SERVICE_CHARGE",
  "REFUNDABLE_DEPOSIT",
]
const DETERMINED = new Set(["CHARGED", "ZERO_RATED", "EXEMPT", "NOT_APPLICABLE"])
const MONEY = /^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const REF = /^[\x21-\x7e]{8,200}$/
function refuse(code: string): never {
  throw new Error("NATIVE_FINAL_CART_" + code)
}
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
  const source = typeof v === "object" && v !== null ? (v as RecordValue) : null
  const raw = source ? source.numeric : v
  // BigNumber numeric may be a binary floating-point number. Use its
  // decimal-string representation instead, never its rounded JS numeric.
  const exact = source && typeof source.toString === "function" ? source.toString() : undefined
  const amount =
    typeof raw === "string"
      ? raw
      : typeof raw === "number" && Number.isSafeInteger(raw)
        ? String(raw)
        : typeof exact === "string"
          ? exact
          : ""
  if (!amount) return refuse("AMOUNT_UNAVAILABLE")
  if (!MONEY.test(amount) || amount.length > 30) return refuse("AMOUNT_UNAVAILABLE")
  const [whole, frac = ""] = amount.split(".")
  if (frac.length > exponent && /[1-9]/.test(frac.slice(exponent))) {
    return refuse("CURRENCY_PRECISION_INVALID")
  }
  const value =
    BigInt(whole) * 10n ** BigInt(exponent) +
    BigInt(frac.slice(0, exponent).padEnd(exponent, "0") || "0")
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return refuse("AMOUNT_UNSAFE")
  return Number(value)
}
/** Persisted DTO money can be exposed as a JS number alongside its exact
 * Medusa raw value. Use the decimal from the same native record. */
function nativeMoney(record: RecordValue, field: string, exponent: number): number {
  if (record[field] == null) return refuse("AMOUNT_UNAVAILABLE")
  const raw = record["raw_" + field]
  return money(raw == null ? record[field] : object(raw).value, exponent)
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
  const t = v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : NaN
  if (!Number.isSafeInteger(t) || t <= 0) return refuse("SOURCE_VERSION_UNAVAILABLE")
  return t
}
function stableHash(value: unknown): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
function ordered(v: unknown): RecordValue[] {
  if (!Array.isArray(v)) return refuse("SOURCE_INCOMPLETE")
  const result = v.map(object)
  result.sort((a, b) => (text(a.id) < text(b.id) ? -1 : text(a.id) > text(b.id) ? 1 : 0))
  if (new Set(result.map((row) => row.id)).size !== result.length) {
    return refuse("DUPLICATE_NATIVE_LINE")
  }
  return result
}
function component(kind: ComponentKind, amount: number, reference: string): FinalNativeComponent {
  if (!REF.test(reference) || !Number.isSafeInteger(amount)) return refuse("DETERMINATION_INVALID")
  return {
    component_kind: kind,
    amount_minor: amount,
    determination: "FINAL",
    source_reference: reference,
  }
}

/**
 * This explicit lock set is deliberately not a cart-row-only read.
 * FOR UPDATE on the cart blocks new FK-backed items/methods; locks on the
 * existing children block changes and insertion of linked tax/adjustment rows
 * before native order COMMIT. Any unreviewed Medusa schema change fails closed.
 */
async function lockNativeCart(
  db: Query,
  cartId: string,
): Promise<{
  currency: string
  updatedAt: number
  updatedAtExact: string
  customerId: string
  routing: unknown[]
}> {
  const cart = await db.query(
    "SELECT id,currency_code,customer_id,completed_at,sales_channel_id,region_id,shipping_address_id,billing_address_id," +
      "to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS updated_at " +
      "FROM cart " +
      "WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
    [cartId],
  )
  if (cart.rows.length !== 1 || cart.rows[0].completed_at !== null) return refuse("CART_NOT_OPEN")
  const currency = text(cart.rows[0].currency_code).toUpperCase()
  const customerId = text(cart.rows[0].customer_id)
  if (!/^[A-Z]{3}$/.test(currency)) return refuse("CURRENCY_INVALID")
  const updatedAt = date(cart.rows[0].updated_at)
  const updatedAtExact = text(cart.rows[0].updated_at)
  const native = cart.rows[0]
  const addressIds = [
    ...new Set(
      [native.shipping_address_id, native.billing_address_id].filter(
        (id) => id !== null && id !== undefined,
      ),
    ),
  ]
  const addresses = addressIds.length
    ? (
        await db.query(
          `SELECT id,address_1,address_2,city,province,postal_code,country_code FROM cart_address
     WHERE id=ANY($1::text[]) AND deleted_at IS NULL ORDER BY id FOR SHARE`,
          [addressIds],
        )
      ).rows
    : []
  if (addresses.length !== addressIds.length) return refuse("ADDRESS_UNAVAILABLE")
  const routing = [
    native.sales_channel_id,
    native.region_id,
    native.shipping_address_id,
    native.billing_address_id,
    addresses.map((a) => [
      a.id,
      a.address_1,
      a.address_2,
      a.city,
      a.province,
      a.postal_code,
      a.country_code,
    ]),
  ]
  const items = await db.query(
    "SELECT id FROM cart_line_item WHERE cart_id=$1 AND deleted_at IS NULL FOR UPDATE",
    [cartId],
  )
  if (!items.rows.length || items.rows.length > 250) return refuse("ITEMS_UNAVAILABLE")
  const methods = await db.query(
    "SELECT id FROM cart_shipping_method WHERE cart_id=$1 AND deleted_at IS NULL FOR UPDATE",
    [cartId],
  )
  if (methods.rows.length > 50) return refuse("SHIPPING_UNAVAILABLE")
  for (const [table, field, ids] of [
    ["cart_line_item_tax_line", "item_id", items.rows.map((r) => r.id)],
    ["cart_line_item_adjustment", "item_id", items.rows.map((r) => r.id)],
    ["cart_shipping_method_tax_line", "shipping_method_id", methods.rows.map((r) => r.id)],
    ["cart_shipping_method_adjustment", "shipping_method_id", methods.rows.map((r) => r.id)],
  ] as const) {
    if (ids.length) {
      await db.query(
        "SELECT id FROM " +
          table +
          " WHERE " +
          field +
          "=ANY($1::text[]) AND deleted_at IS NULL FOR UPDATE",
        [ids],
      )
    }
  }
  return { currency, updatedAt, updatedAtExact, customerId, routing }
}

function assertSameIds(actual: RecordValue[], native: RecordValue[], code: string): void {
  const a = actual.map((r) => text(r.id)).sort()
  const b = native.map((r) => text(r.id)).sort()
  if (JSON.stringify(a) !== JSON.stringify(b)) refuse(code)
}

type CartTransactionManager = {
  getTransactionContext(): object | undefined
  setTransactionContext(transaction: object): void
  resetTransactionContext(): void
}

/** Bind a fresh Cart manager to the Order owner's existing PostgreSQL
 * transaction. The Order manager lacks Cart entity metadata. A fresh Cart
 * identity map also forces each price read to see changes in this XID.
 */
function cartOnOrderTransaction(cartModule: NativeCartModule): NativeCartModule {
  return {
    async retrieveCart(id, config, context) {
      const owner = (context as { transactionManager?: CartTransactionManager })?.transactionManager
      const transaction = owner?.getTransactionContext?.()
      const repository = (
        cartModule as NativeCartModule & {
          baseRepository_?: { getFreshManager(): CartTransactionManager }
        }
      ).baseRepository_
      const manager = repository?.getFreshManager?.()
      if (
        !transaction ||
        !manager ||
        manager === owner ||
        typeof manager.getTransactionContext !== "function" ||
        typeof manager.setTransactionContext !== "function" ||
        typeof manager.resetTransactionContext !== "function" ||
        manager.getTransactionContext() != null
      ) {
        return refuse("CART_TRANSACTION_UNAVAILABLE")
      }
      // The Order Module owns commit and rollback. Reset only this fork's
      // reference after the read and never close the underlying transaction.
      manager.setTransactionContext(transaction)
      try {
        return await cartModule.retrieveCart(id, config, { transactionManager: manager })
      } finally {
        manager.resetTransactionContext()
      }
    },
  }
}

/**
 * Ready-to-compose native Cart Module boundary. A caller can register this
 * function as its NativeMedusaOrderSource.readFinalCart implementation, but
 * the caller must still provide genuine native order/ERP readers and fresh
 * IAM/CP operation authority. No endpoint or provider is activated here.
 */
export function nativeMedusaCartPriceReadback(
  cartModule: NativeCartModule,
  currencyExponent: (db: Query, currency: string) => Promise<number>,
  verifyCurrentIssuer: CurrentPriceIssuerAuthority,
) {
  const transactionalCart = cartOnOrderTransaction(cartModule)
  return async (
    db: Query,
    _nativeOrderId: string,
    authority: {
      receipt: {
        resource_id: string
        tenant_id: string
        market_id: string
        seller_legal_entity_id: string
        currency: string
      }
    },
    manager: unknown,
  ): Promise<NativeFinalCartPrice> => {
    if (
      typeof currencyExponent !== "function" ||
      !authority?.receipt?.resource_id ||
      !authority?.receipt?.tenant_id ||
      !authority.receipt.market_id ||
      !authority.receipt.seller_legal_entity_id
    ) {
      return refuse("READER_UNAVAILABLE")
    }
    return readMedusaFinalCartPrice({
      db,
      transactionManager: manager,
      cartModule: transactionalCart,
      cartId: authority.receipt.resource_id,
      tenantId: authority.receipt.tenant_id,
      marketId: authority.receipt.market_id,
      sellerLegalEntityId: authority.receipt.seller_legal_entity_id,
      currencyExponent: await currencyExponent(db, authority.receipt.currency),
      verifyCurrentIssuer,
    })
  }
}

export async function readMedusaFinalCartPrice(
  scope: NativeCartPriceScope,
): Promise<NativeFinalCartPrice> {
  const now = scope.now ?? new Date()
  if (
    !Number.isSafeInteger(scope.currencyExponent) ||
    scope.currencyExponent < 0 ||
    scope.currencyExponent > 9 ||
    !Number.isFinite(now.getTime()) ||
    typeof scope.verifyCurrentIssuer !== "function" ||
    !scope.transactionManager ||
    !scope.cartModule ||
    typeof scope.cartModule.retrieveCart !== "function"
  )
    return refuse("READER_UNAVAILABLE")
  const locked = await lockNativeCart(scope.db, scope.cartId)
  const nativeItems = await scope.db.query(
    "SELECT id FROM cart_line_item WHERE cart_id=$1 AND deleted_at IS NULL FOR SHARE",
    [scope.cartId],
  )
  const nativeShipping = await scope.db.query(
    "SELECT id FROM cart_shipping_method WHERE cart_id=$1 AND deleted_at IS NULL FOR SHARE",
    [scope.cartId],
  )
  // Cart credit lines are real native records. Lock their rows and refuse
  // any tender until the commitment model can govern it explicitly.
  const creditLines = await scope.db.query(
    "SELECT id FROM credit_line WHERE cart_id=$1 AND deleted_at IS NULL FOR SHARE",
    [scope.cartId],
  )
  if (creditLines.rows.length) return refuse("UNSUPPORTED_CART_TENDER")
  const cart = object(
    await scope.cartModule.retrieveCart(
      scope.cartId,
      {
        // The pinned Cart Module treats total as a calculation trigger. It
        // loads all required relations and computes discount/credit totals;
        // those calculated names must never become ORM column selectors.
        select: ["id", "customer_id", "currency_code", "updated_at", "completed_at", "total"],
        relations: [],
      },
      { transactionManager: scope.transactionManager },
    ),
  )
  if (
    cart.id !== scope.cartId ||
    text(cart.currency_code).toUpperCase() !== locked.currency ||
    cart.customer_id !== locked.customerId ||
    cart.completed_at !== null ||
    date(cart.updated_at) !== locked.updatedAt
  )
    return refuse("NATIVE_CART_CHANGED")
  const items = ordered(cart.items)
  const shipping = ordered(cart.shipping_methods)
  assertSameIds(items, nativeItems.rows, "ITEM_SET_CHANGED")
  assertSameIds(shipping, nativeShipping.rows, "SHIPPING_SET_CHANGED")
  const e = scope.currencyExponent
  const merchandise = nativeMoney(cart, "item_subtotal", e)
  const freight = nativeMoney(cart, "shipping_subtotal", e)
  const discount = nativeMoney(cart, "discount_subtotal", e)
  const tax = nativeMoney(cart, "tax_total", e)
  const nativeTotal = nativeMoney(cart, "total", e)
  if (
    BigInt(nativeMoney(cart, "subtotal", e)) !== BigInt(merchandise) + BigInt(freight) ||
    BigInt(nativeMoney(cart, "item_tax_total", e)) +
      BigInt(nativeMoney(cart, "shipping_tax_total", e)) !==
      BigInt(tax) ||
    nativeMoney(cart, "credit_line_total", e) !== 0 ||
    // Medusa 2.21.2 does not emit a gift-card total. Any future value must
    // be zero; its actual credit-line records and computed total are required.
    (cart.gift_card_total != null && nativeMoney(cart, "gift_card_total", e) !== 0) ||
    BigInt(nativeTotal) !== BigInt(merchandise) + BigInt(freight) + BigInt(tax) - BigInt(discount)
  )
    return refuse("NATIVE_TOTALS_INCONSISTENT")
  const lineComponents: FinalNativeComponent[] = []
  const lineFingerprint: unknown[] = []
  let itemSum = 0n
  for (const item of items) {
    const id = text(item.id)
    const qty = nativeMoney(item, "quantity", 0)
    if (qty <= 0 || !text(item.variant_id)) {
      return refuse("ITEM_SOURCE_INCOMPLETE")
    }
    const unit = nativeMoney(item, "unit_price", e)
    const subtotal = nativeMoney(item, "subtotal", e)
    if (BigInt(unit) * BigInt(qty) !== BigInt(subtotal)) {
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
    const amount = nativeMoney(method, "subtotal", e)
    shippingSum += BigInt(amount)
    shippingFingerprint.push([text(method.id), amount])
  }
  if (shippingSum !== BigInt(freight)) return refuse("FREIGHT_TOTAL_CHANGED")

  // All seven classes require explicit scoped provenance from a trusted issuer; the
  // database record alone is not IAM/CP or provider certification. No missing row is acceptable.
  const evidence = await scope.db.query(
    "SELECT d.charge_kind,d.resolution,d.amount_minor,d.currency,d.source_reference," +
      "d.evaluated_at,d.expires_at,d.resource_version,a.issuer_id," +
      "a.attestation_id::text AS attestation_id,a.cp_decision_id::text AS cp_decision_id," +
      "a.source_digest,a.policy_reference,a.cart_updated_at_exact," +
      "a.zero_reason,a.canonical_evidence,a.issuer_signature,a.signer_key_fingerprint " +
      "FROM trade_native_cart_charge_determination d " +
      "JOIN trade_native_cart_charge_authority a USING " +
      "(tenant_id,cart_id,market_id,seller_legal_entity_id,resource_version,charge_kind) " +
      "WHERE d.tenant_id=$1 AND d.cart_id=$2 AND d.market_id=$3 " +
      "AND d.seller_legal_entity_id=$4 AND d.resource_version=$5 FOR SHARE OF d,a",
    [scope.tenantId, scope.cartId, scope.marketId, scope.sellerLegalEntityId, locked.updatedAt],
  )
  if (evidence.rows.length !== CHARGES.length) return refuse("CHARGE_DETERMINATION_MISSING")
  // The full signed price package is immutable, and is verified AGAIN by the
  // native owner, not trusted merely because a provider once wrote a digest.
  // Protected deployments without a reviewed price signing key deny.
  const trustedPem = process.env.BAOBAB_NATIVE_PRICE_ISSUER_PUBLIC_KEY_PEM
  if (!trustedPem) return refuse("ISSUER_KEY_UNAVAILABLE")
  let signer: ReturnType<typeof createPublicKey>
  try {
    signer = createPublicKey(trustedPem)
    if (signer.asymmetricKeyType !== "ed25519" || signer.type !== "public") {
      return refuse("ISSUER_KEY_UNAVAILABLE")
    }
  } catch {
    return refuse("ISSUER_KEY_UNAVAILABLE")
  }
  const keyFingerprint = createHash("sha256")
    .update(
      signer.export({
        type: "spki",
        format: "der",
      }),
    )
    .digest("hex")
  const issuerBindings = new Set<string>()
  const proofs: unknown[] = []
  const cost: Partial<Record<ChargeKind, number>> = {}
  const references: Partial<Record<ChargeKind, string>> = {}
  for (const row of evidence.rows) {
    if (
      !CHARGES.includes(row.charge_kind as ChargeKind) ||
      cost[row.charge_kind as ChargeKind] !== undefined ||
      !DETERMINED.has(String(row.resolution)) ||
      row.currency !== locked.currency ||
      Number(row.resource_version) !== locked.updatedAt ||
      date(row.evaluated_at) > now.getTime() ||
      date(row.expires_at) <= now.getTime() ||
      typeof row.source_reference !== "string" ||
      !REF.test(row.source_reference) ||
      row.cart_updated_at_exact !== locked.updatedAtExact ||
      typeof row.issuer_id !== "string" ||
      !REF.test(row.issuer_id) ||
      typeof row.attestation_id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(row.attestation_id) ||
      typeof row.cp_decision_id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(row.cp_decision_id) ||
      typeof row.policy_reference !== "string" ||
      !REF.test(row.policy_reference) ||
      typeof row.source_digest !== "string" ||
      !/^[0-9a-f]{64}$/.test(row.source_digest)
    ) {
      return refuse("CHARGE_DETERMINATION_INVALID")
    }
    const value = numericMinor(row.amount_minor)
    if (
      (row.resolution === "CHARGED" && value === 0) ||
      (row.resolution !== "CHARGED" && value !== 0)
    ) {
      return refuse("UNJUSTIFIED_ZERO_OR_CHARGE")
    }
    issuerBindings.add(
      [
        row.issuer_id,
        row.attestation_id,
        row.cp_decision_id,
        row.source_digest,
        row.policy_reference,
      ].join("\u0000"),
    )
    const packageValue = row.canonical_evidence as ChargeEvidence | null
    if (
      !packageValue ||
      typeof packageValue !== "object" ||
      !Array.isArray(packageValue.charges) ||
      packageValue.charges.length !== CHARGES.length ||
      packageValue.cartId !== scope.cartId ||
      packageValue.tenantId !== scope.tenantId ||
      packageValue.marketId !== scope.marketId ||
      packageValue.sellerLegalEntityId !== scope.sellerLegalEntityId ||
      packageValue.currency !== locked.currency ||
      packageValue.resourceVersion !== locked.updatedAt ||
      packageValue.issuerId !== row.issuer_id ||
      packageValue.attestationId !== row.attestation_id ||
      packageValue.policyReference !== row.policy_reference ||
      date(packageValue.evaluatedAt) !== date(row.evaluated_at) ||
      date(packageValue.expiresAt) !== date(row.expires_at) ||
      packageValue.cartUpdatedAtExact !== locked.updatedAtExact ||
      row.signer_key_fingerprint !== keyFingerprint ||
      typeof row.issuer_signature !== "string"
    ) {
      return refuse("SIGNED_ISSUER_SCOPE_INVALID")
    }
    const bytes = signedChargeBytes(packageValue)
    const digest = createHash("sha256").update(bytes).digest("hex")
    const sig = Buffer.from(row.issuer_signature, "base64url")
    if (row.source_digest !== digest || sig.length !== 64 || !verify(null, bytes, signer, sig))
      return refuse("ISSUER_SIGNATURE_INVALID")
    const signedLine = packageValue.charges.find((line) => line.kind === row.charge_kind)
    if (
      !signedLine ||
      signedLine.amountMinor !== String(row.amount_minor) ||
      signedLine.resolution !== row.resolution ||
      signedLine.sourceReference !== row.source_reference ||
      signedLine.zeroReason !== row.zero_reason ||
      (value === 0 && !signedLine.zeroReason) ||
      (value > 0 && signedLine.zeroReason !== null)
    ) {
      return refuse("SIGNED_ISSUER_CHARGE_CHANGED")
    }
    const kind = row.charge_kind as ChargeKind
    cost[kind] = value
    references[kind] = row.source_reference
    proofs.push([
      kind,
      row.resolution,
      value,
      row.source_reference,
      date(row.expires_at),
      row.issuer_id,
      row.attestation_id,
      row.cp_decision_id,
      row.source_digest,
      row.policy_reference,
      row.cart_updated_at_exact,
      row.issuer_signature,
      row.signer_key_fingerprint,
    ])
  }
  // The original issuer decision must STILL be current, online and scoped
  // to this exact immutable package before an order or spend is committed.
  // This call is made on both transaction-bound source reads, not cached.
  const first = evidence.rows[0]
  const priceIssuerCheck: NativePriceIssuerCheck = {
    tenantId: scope.tenantId,
    cartId: scope.cartId,
    marketId: scope.marketId,
    sellerLegalEntityId: scope.sellerLegalEntityId,
    currency: locked.currency,
    issuerId: String(first.issuer_id),
    decisionId: String(first.cp_decision_id),
    sourceDigest: String(first.source_digest),
    policyReference: String(first.policy_reference),
  }
  let live: NativePriceIssuerDecision
  try {
    live = await scope.verifyCurrentIssuer(priceIssuerCheck)
  } catch {
    return refuse("ISSUER_CURRENT_AUTHORITY_UNAVAILABLE")
  }
  const checkedAt = scope.now?.getTime() ?? Date.now()
  const leaseExpiresAt = Math.min(
    Date.parse(live?.expiresAt ?? ""),
    ...evidence.rows.map((row) => date(row.expires_at)),
  )
  if (
    live?.outcome !== "AUTHORIZED" ||
    live.decisionId !== priceIssuerCheck.decisionId ||
    live.issuerId !== priceIssuerCheck.issuerId ||
    live.tenantId !== priceIssuerCheck.tenantId ||
    live.marketId !== priceIssuerCheck.marketId ||
    live.sellerLegalEntityId !== priceIssuerCheck.sellerLegalEntityId ||
    live.policyReference !== priceIssuerCheck.policyReference ||
    live.sourceDigest !== priceIssuerCheck.sourceDigest ||
    !Number.isFinite(leaseExpiresAt) ||
    checkedAt < now.getTime() ||
    leaseExpiresAt <= checkedAt
  ) {
    return refuse("ISSUER_CURRENT_AUTHORITY_DENIED")
  }
  // One coherent signed price package and CP decision; mixing multiple
  // issuers' separate answers would bypass whole-cart governance.
  if (issuerBindings.size !== 1) return refuse("ISSUER_PROVENANCE_MISMATCH")
  if (!CHARGES.every((kind) => cost[kind] !== undefined)) {
    return refuse("CHARGE_DETERMINATION_MISSING")
  }
  if (cost.TAX !== tax || cost.FREIGHT !== freight) {
    return refuse("TAX_OR_FREIGHT_MISMATCH")
  }
  proofs.sort((a, b) =>
    JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0,
  )
  const assessed = (kind: ChargeKind, componentKind: FinalNativeComponent["component_kind"]) => {
    const value = cost[kind]
    const reference = references[kind]
    if (value === undefined || reference === undefined)
      return refuse("CHARGE_DETERMINATION_MISSING")
    return component(componentKind, value, reference)
  }
  const components = [
    ...lineComponents,
    component("ORDER_DISCOUNT", -discount, "native:cart-discount:" + scope.cartId),
    assessed("FREIGHT", "SHIPPING"),
    assessed("TAX", "TAX"),
    assessed("DUTY", "DUTY_AND_IMPORT_CHARGE"),
    assessed("HANDLING", "HANDLING"),
    assessed("INSURANCE", "INSURANCE"),
    assessed("SERVICE_CHARGE", "SERVICE_CHARGE"),
    assessed("REFUNDABLE_DEPOSIT", "REFUNDABLE_DEPOSIT"),
  ]
  const fingerprint = stableHash({
    id: scope.cartId,
    updated_at: locked.updatedAtExact,
    customer: locked.customerId,
    routing: locked.routing,
    tenant: scope.tenantId,
    market: scope.marketId,
    seller: scope.sellerLegalEntityId,
    currency: locked.currency,
    lineFingerprint,
    shippingFingerprint,
    merchandise,
    freight,
    discount,
    tax,
    nativeTotal,
    proofs,
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
    leaseExpiresAt,
  }
}
