import { describe, expect, it, vi } from "vitest"
import { medusaNativeOrderFactsSource } from "../src/baobab/b2b/medusa-native-order-source"
import { syntheticCommitmentProof } from "./fixtures/native-buyer-commitment"

/** SQL-shaped source tests. The disposable Medusa workflow owns live XID evidence. */
function fixture() {
  const authority = syntheticCommitmentProof()
  authority.receipt.currency = "ZAR"
  authority.receipt.amount_minor = 2300
  authority.valuation.components = [
    {
      component_kind: "MERCHANDISE",
      amount_minor: 2000,
      source_reference: "cart-line",
      determination: "FINAL",
    },
    {
      component_kind: "TAX",
      amount_minor: 300,
      source_reference: "signed-tax",
      determination: "FINAL",
    },
  ]
  const cart = {
    id: authority.receipt.resource_id,
    customer_id: "cus_buyer",
    region_id: "reg_market",
    sales_channel_id: "sc_estate",
    email: "buyer@example.invalid",
    currency_code: "zar",
    shipping_address_id: "caaddr_1",
    billing_address_id: "caaddr_2",
  }
  const order = {
    ...cart,
    id: "order_genuine",
    version: 1,
    status: "pending",
    is_draft_order: false,
    created_at: new Date("2026-11-05T10:00:00Z"),
    shipping_address_id: "ordaddr_1",
    billing_address_id: "ordaddr_2",
  }
  const line = {
    id: "cali_item",
    variant_id: "variant_genuine",
    product_id: "prod_genuine",
    title: "Native catalogue item",
    quantity: "2",
    unit_price: "10.00",
    is_giftcard: false,
    is_tax_inclusive: false,
    requires_shipping: true,
    adjusted: false,
    trade_uom: "EA",
    taxes: [{ code: "NATIVE_RATE", rate: "15", provider_id: "tp_native" }],
  }
  const persisted = { ...structuredClone(line), id: "ordli_genuine", same_xid: true }
  const method = {
    name: "Governed pickup",
    shipping_option_id: "so_native",
    amount: "0",
    is_tax_inclusive: false,
    adjusted: false,
    taxed: false,
    same_xid: true,
  }
  const query = vi.fn(async (sql: string) => {
    let rows: Array<Record<string, unknown>>
    if (sql.includes("FROM currency")) rows = [{ decimal_digits: 2 }]
    else if (sql.includes("FROM cart_address") || sql.includes("FROM order_address"))
      rows = [{ address_1: "Test Site", city: "Cape Town", country_code: "za" }]
    else if (sql.includes("FROM order_shipping os")) rows = [method]
    else if (sql.includes("FROM cart_shipping_method s")) rows = [method]
    else if (sql.includes("FROM order_item i")) rows = [persisted]
    else if (sql.includes("FROM cart_line_item l")) rows = [line]
    else if (sql.includes('FROM "order"')) rows = [order]
    else if (sql.includes("FROM cart WHERE")) rows = [cart]
    else throw new Error("Unexpected query in native facts test")
    return { rows, rowCount: rows.length }
  })
  return {
    source: medusaNativeOrderFactsSource(),
    db: { query },
    authority,
    order,
    persisted,
    method,
  }
}

describe("native Medusa order facts", () => {
  it("builds a non-draft order and derives the ERP totals from persisted native facts", async () => {
    const h = fixture()
    const input = await h.source.orderInput(h.db, h.order.id, h.authority)
    expect(input).toMatchObject({
      status: "pending",
      is_draft_order: false,
      items: [{ quantity: "2", unit_price: "10.00", tax_lines: [{ rate: 15 }] }],
    })
    const final = await h.source.readFinal(h.db, h.order.id, h.authority)
    expect(final.erp).toMatchObject({
      customer_id: "cus_buyer",
      order_version: 1,
      lines: [
        { line_id: "ordli_genuine", sku_id: "variant_genuine", line_total: { amount: "23.00" } },
      ],
      totals: {
        subtotal: { amount: "20.00" },
        quoted_tax: { amount: "3.00" },
        grand_total: { amount: "23.00" },
      },
    })
  })

  it("refuses changed money, a draft or a line written outside the owning transaction", async () => {
    for (const mutate of [
      (h: ReturnType<typeof fixture>) => {
        h.persisted.unit_price = "9.00"
      },
      (h: ReturnType<typeof fixture>) => {
        h.persisted.same_xid = false
      },
      (h: ReturnType<typeof fixture>) => {
        h.order.is_draft_order = true
      },
      (h: ReturnType<typeof fixture>) => {
        h.method.same_xid = false
      },
    ]) {
      const h = fixture()
      mutate(h)
      await expect(h.source.readFinal(h.db, h.order.id, h.authority)).rejects.toThrow(
        "NATIVE_MEDUSA_ORDER_FACTS_NOT_PROVEN",
      )
    }
  })

  it("does not silently drop a signed duty amount from the order", async () => {
    const h = fixture()
    h.authority.valuation.components.push({
      component_kind: "DUTY_AND_IMPORT_CHARGE",
      amount_minor: 1,
      source_reference: "signed-duty",
      determination: "FINAL",
    })
    await expect(h.source.orderInput(h.db, h.order.id, h.authority)).rejects.toThrow(
      "NATIVE_MEDUSA_ORDER_FACTS_NOT_PROVEN",
    )
  })
})
