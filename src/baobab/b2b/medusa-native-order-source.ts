import type { OrderTypes } from "@medusajs/framework/types"
import type { PgClient } from "../orders/postgres-governed-binding-persistence"
import type { NativeMedusaOrderSource } from "./medusa-native-transaction-owner"
import { exactMoneyMinor, type AuthorizedCommitment } from "./native-buyer-commitment"
import type { FinalNativeValuationFacts } from "./buyer-commitment-valuation"
import { readNativeCurrencyExponent } from "./native-currency-exponent"

export type NativeOrderFactsSource = Pick<NativeMedusaOrderSource, "orderInput" | "readFinal">
type Query = Pick<PgClient, "query">
type Row = Record<string, unknown>
type OrderFacts = {
  receipt: Pick<
    AuthorizedCommitment["receipt"],
    "resource_id" | "currency" | "amount_minor" | "market_id"
  >
  seller: Pick<AuthorizedCommitment["seller"], "responsible_legal_entity_id">
  valuation: FinalNativeValuationFacts
}

function refuse(): never {
  throw new Error("NATIVE_MEDUSA_ORDER_FACTS_NOT_PROVEN")
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return refuse()
  return value
}
function one(rows: Row[]): Row {
  if (rows.length !== 1) return refuse()
  return rows[0]
}
function minor(value: unknown, exponent: number): bigint {
  const amount = exactMoneyMinor(text(value), exponent)
  if (amount === null || amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) return refuse()
  return amount
}
const addressFields = [
  "first_name",
  "last_name",
  "company",
  "address_1",
  "address_2",
  "city",
  "province",
  "postal_code",
  "country_code",
  "phone",
] as const
async function address(db: Query, id: unknown, owner: "cart" | "order") {
  const row = one(
    (
      await db.query(
        `SELECT ${addressFields.join(",")} FROM ${owner}_address WHERE id=$1 AND deleted_at IS NULL FOR SHARE`,
        [text(id)],
      )
    ).rows,
  )
  return Object.fromEntries(
    addressFields.flatMap((field) =>
      row[field] == null || row[field] === "" ? [] : [[field, text(row[field])]],
    ),
  )
}

function taxLines(value: unknown): OrderTypes.CreateOrderTaxLineDTO[] {
  if (!Array.isArray(value) || value.length > 20) return refuse()
  return value.map((item: Row) => {
    const rate = minor(item.rate, 6)
    if (rate > 100_000_000n) return refuse()
    return {
      rate: Number(rate) / 1_000_000,
      code: text(item.code),
      ...(item.tax_rate_id == null ? {} : { tax_rate_id: text(item.tax_rate_id) }),
      ...(item.provider_id == null ? {} : { provider_id: text(item.provider_id) }),
    }
  })
}

// These SQL reads run after the existing native cart locks and live issuer
// check. Never use caller metadata for SKU, unit, price or destination.
const CART_LINES = `SELECT l.id,l.variant_id,l.product_id,l.title,l.quantity::text,l.unit_price::text,
    l.is_tax_inclusive,l.is_giftcard,l.requires_shipping,p.trade_uom,
    EXISTS(SELECT 1 FROM cart_line_item_adjustment a WHERE a.item_id=l.id AND a.deleted_at IS NULL) AS adjusted,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('rate',t.rate::text,'code',t.code,'tax_rate_id',t.tax_rate_id,
      'provider_id',t.provider_id) ORDER BY t.code,t.tax_rate_id,t.provider_id,t.rate), '[]')
      FROM cart_line_item_tax_line t WHERE t.item_id=l.id AND t.deleted_at IS NULL) AS taxes
  FROM cart_line_item l LEFT JOIN b2b_product_trade_profile p ON p.product_id=l.product_id AND p.deleted_at IS NULL
  WHERE l.cart_id=$1 AND l.deleted_at IS NULL ORDER BY l.id LIMIT 251`
const ORDER_LINES = `SELECT l.id,l.variant_id,l.product_id,l.title,i.quantity::text,
    coalesce(i.unit_price,l.unit_price)::text AS unit_price,l.is_tax_inclusive,l.is_giftcard,l.requires_shipping,
    i.xmin=l.xmin AND i.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text AS same_xid,
    EXISTS(SELECT 1 FROM order_line_item_adjustment a WHERE a.item_id=l.id AND a.deleted_at IS NULL) AS adjusted,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('rate',t.rate::text,'code',t.code,'tax_rate_id',t.tax_rate_id,
      'provider_id',t.provider_id) ORDER BY t.code,t.tax_rate_id,t.provider_id,t.rate), '[]')
      FROM order_line_item_tax_line t WHERE t.item_id=l.id AND t.deleted_at IS NULL) AS taxes
  FROM order_item i JOIN order_line_item l ON l.id=i.item_id AND l.deleted_at IS NULL
  WHERE i.order_id=$1 AND i.version=$2 AND i.deleted_at IS NULL ORDER BY l.id LIMIT 251`

async function cartFacts(db: Query, authority: OrderFacts) {
  const receipt = authority.receipt
  const cart = one(
    (
      await db.query(
        `SELECT id,customer_id,sales_channel_id,region_id,email,currency_code,
      shipping_address_id,billing_address_id FROM cart WHERE id=$1 AND completed_at IS NULL AND deleted_at IS NULL`,
        [receipt.resource_id],
      )
    ).rows,
  )
  const currency = text(cart.currency_code).toUpperCase()
  if (currency !== receipt.currency) return refuse()
  // The first ERP payload profile represents merchandise and native tax.
  // An issuer must determine every other charge as zero. No fee may vanish
  // from the order or its consequence merely because ERP lacks a field.
  if (
    authority.valuation.components.some(
      (c) =>
        c.amount_minor !== 0 && c.component_kind !== "MERCHANDISE" && c.component_kind !== "TAX",
    )
  )
    return refuse()
  const exponent = await readNativeCurrencyExponent(db, currency)
  const rows = (await db.query(CART_LINES, [cart.id])).rows
  if (
    rows.length === 0 ||
    rows.length > 250 ||
    new Set(rows.map((r) => r.variant_id)).size !== rows.length
  )
    return refuse()
  const methods = (
    await db.query(
      `SELECT name,shipping_option_id,amount::text,is_tax_inclusive,data,
      EXISTS(SELECT 1 FROM cart_shipping_method_adjustment a WHERE a.shipping_method_id=s.id AND a.deleted_at IS NULL) AS adjusted,
      EXISTS(SELECT 1 FROM cart_shipping_method_tax_line t WHERE t.shipping_method_id=s.id AND t.deleted_at IS NULL AND t.rate<>0) AS taxed
    FROM cart_shipping_method s WHERE cart_id=$1 AND deleted_at IS NULL LIMIT 2`,
      [cart.id],
    )
  ).rows
  const method = one(methods)
  if (
    minor(method.amount, exponent) !== 0n ||
    method.adjusted !== false ||
    method.taxed !== false ||
    method.is_tax_inclusive !== false
  )
    return refuse()
  return { cart, rows, method, currency, exponent }
}

function lineFacts(row: Row, exponent: number) {
  if (
    row.is_tax_inclusive !== false ||
    row.is_giftcard !== false ||
    row.adjusted !== false ||
    typeof row.requires_shipping !== "boolean"
  )
    return refuse()
  const quantity = minor(row.quantity, 0)
  const unit = minor(row.unit_price, exponent)
  if (quantity < 1n || unit < 1n) return refuse()
  return {
    quantity,
    unit,
    tax: taxLines(row.taxes),
    product: text(row.product_id),
    variant: text(row.variant_id),
    shipping: row.requires_shipping,
  }
}

/** Builds the Order Module input from persisted native rows, then reads the
 * resulting order and lines over the same owner transaction. It owns no
 * permission, external SKU mapping, or settlement. */
export function medusaNativeOrderFactsSource() {
  return {
    async orderInput(db: Query, id: string, authority: OrderFacts) {
      const { cart, rows, method, currency, exponent } = await cartFacts(db, authority)
      return {
        id,
        status: "pending",
        is_draft_order: false,
        no_notification: true,
        customer_id: text(cart.customer_id),
        region_id: text(cart.region_id),
        sales_channel_id: text(cart.sales_channel_id),
        email: text(cart.email),
        currency_code: currency.toLowerCase(),
        shipping_address: await address(db, cart.shipping_address_id, "cart"),
        billing_address: await address(db, cart.billing_address_id, "cart"),
        items: rows.map((row) => {
          const line = lineFacts(row, exponent)
          return {
            title: text(row.title),
            quantity: line.quantity.toString(),
            unit_price: text(row.unit_price),
            variant_id: line.variant,
            product_id: line.product,
            requires_shipping: line.shipping,
            is_tax_inclusive: false,
            tax_lines: line.tax,
          }
        }),
        shipping_methods: [
          {
            name: text(method.name),
            shipping_option_id: text(method.shipping_option_id),
            amount: "0",
            is_tax_inclusive: false,
            ...(method.data == null ? {} : { data: method.data as Record<string, unknown> }),
          },
        ],
      }
    },
    async readFinal(db: Query, id: string, authority: OrderFacts) {
      const { cart, rows, method, currency, exponent } = await cartFacts(db, authority)
      const order = one(
        (
          await db.query(
            `SELECT id,version,customer_id,region_id,sales_channel_id,email,currency_code,
          is_draft_order,status,created_at,shipping_address_id,billing_address_id FROM "order" WHERE id=$1 AND deleted_at IS NULL`,
            [id],
          )
        ).rows,
      )
      if (
        order.is_draft_order !== false ||
        order.status !== "pending" ||
        order.version !== 1 ||
        ["customer_id", "region_id", "sales_channel_id", "email", "currency_code"].some(
          (field) => order[field] !== cart[field],
        )
      )
        return refuse()
      for (const field of ["shipping_address_id", "billing_address_id"]) {
        if (
          JSON.stringify(await address(db, cart[field], "cart")) !==
          JSON.stringify(await address(db, order[field], "order"))
        )
          return refuse()
      }
      const methods = await db.query(
        `SELECT sm.name,sm.shipping_option_id,sm.amount::text,sm.is_tax_inclusive,
          os.xmin=sm.xmin AND os.xmin::text=mod(pg_current_xact_id()::text::numeric,4294967296)::text AS same_xid,
          EXISTS(SELECT 1 FROM order_shipping_method_adjustment a WHERE a.shipping_method_id=sm.id AND a.deleted_at IS NULL) AS adjusted,
          EXISTS(SELECT 1 FROM order_shipping_method_tax_line t WHERE t.shipping_method_id=sm.id AND t.deleted_at IS NULL AND t.rate<>0) AS taxed
        FROM order_shipping os JOIN order_shipping_method sm ON sm.id=os.shipping_method_id AND sm.deleted_at IS NULL
        WHERE os.order_id=$1 AND os.version=$2 AND os.deleted_at IS NULL`,
        [id, order.version],
      )
      const actualMethod = one(methods.rows)
      if (
        actualMethod.same_xid !== true ||
        actualMethod.name !== method.name ||
        actualMethod.shipping_option_id !== method.shipping_option_id ||
        minor(actualMethod.amount, exponent) !== 0n ||
        actualMethod.is_tax_inclusive !== false ||
        actualMethod.adjusted !== false ||
        actualMethod.taxed !== false
      )
        return refuse()
      const persisted = (await db.query(ORDER_LINES, [id, order.version])).rows
      if (
        persisted.length !== rows.length ||
        new Set(persisted.map((r) => r.variant_id)).size !== rows.length
      )
        return refuse()
      const money = (n: bigint) => {
        const digits = n.toString().padStart(exponent + 1, "0")
        return {
          amount: exponent ? digits.slice(0, -exponent) + "." + digits.slice(-exponent) : digits,
          currency,
        }
      }
      let subtotal = 0n
      let taxTotal = 0n
      const lines = persisted.map((row) => {
        if (row.same_xid !== true) return refuse()
        const actual = lineFacts(row, exponent)
        const source = rows.find((candidate) => candidate.variant_id === actual.variant)
        if (!source) return refuse()
        const expected = lineFacts(source, exponent)
        if (
          actual.product !== expected.product ||
          actual.quantity !== expected.quantity ||
          actual.unit !== expected.unit ||
          actual.shipping !== expected.shipping ||
          JSON.stringify(actual.tax) !== JSON.stringify(expected.tax)
        )
          return refuse()
        const lineSubtotal = actual.quantity * actual.unit
        const numerator = actual.tax.reduce(
          (sum, t) => sum + lineSubtotal * minor(String(t.rate), 6),
          0n,
        )
        if (numerator % 100_000_000n !== 0n) return refuse()
        const lineTax = numerator / 100_000_000n
        subtotal += lineSubtotal
        taxTotal += lineTax
        return {
          line_id: text(row.id),
          sku_id: actual.variant,
          quantity: { value: actual.quantity.toString(), unit: text(source.trade_uom) },
          unit_price: money(actual.unit),
          quoted_tax_total: money(lineTax),
          line_total: money(lineSubtotal + lineTax),
        }
      })
      const total = subtotal + taxTotal
      const byKind = (kind: "MERCHANDISE" | "TAX") =>
        authority.valuation.components
          .filter((c) => c.component_kind === kind)
          .reduce((sum, c) => sum + BigInt(c.amount_minor), 0n)
      if (
        subtotal !== byKind("MERCHANDISE") ||
        taxTotal !== byKind("TAX") ||
        total !== BigInt(authority.receipt.amount_minor)
      )
        return refuse()
      return {
        valuation: authority.valuation,
        currencyExponent: exponent,
        erp: {
          legal_entity_id: authority.seller.responsible_legal_entity_id,
          commerce_order_id: text(order.id),
          order_version: order.version,
          customer_id: text(order.customer_id),
          market_id: authority.receipt.market_id,
          sales_channel_id: text(order.sales_channel_id),
          placed_at: new Date(order.created_at as string | Date).toISOString(),
          currency,
          lines,
          totals: {
            subtotal: money(subtotal),
            discount: money(0n),
            quoted_tax: money(taxTotal),
            grand_total: money(total),
          },
        },
      }
    },
  } satisfies NativeOrderFactsSource
}
