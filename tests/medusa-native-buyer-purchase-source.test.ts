import { describe, expect, it, vi } from "vitest"
import type { IOrderModuleService } from "@medusajs/framework/types"
import type { BuyerIdentitySnapshot } from "../src/baobab/b2b/buyer-authority"
import { medusaNativeBuyerPurchaseSource } from "../src/baobab/b2b/medusa-native-buyer-purchase-source"

const cartId = "cart_exact3456789"
const identity = {
  tenant_id: "tn_trade_za",
  buyer_organisation_id: "b2borg_buyer",
  buyer_membership_id: "b2bmem_buyer",
  actor_principal_id: "cp_principal_owner",
  canonical_organisation_id: "019a0915-a8c0-7000-8000-00000000a001",
  market_id: "market_za",
} as BuyerIdentitySnapshot
const seller = {
  tenant_id: identity.tenant_id,
  seller_organisation_id: "org_seller_only",
  responsible_legal_entity_id: "le_actual_za",
  market_code: "ZA",
  market_key: "ZA",
  currency_code: "ZAR",
  cart_currency: "zar",
  cart_customer_id: "cus_native_buyer",
  sales_channel_id: "sc_actual",
  region_id: "reg_actual",
}
const reservation = {
  id: "b2bres_paid_hold",
  tenant_id: identity.tenant_id,
  organisation_id: identity.buyer_organisation_id,
  membership_id: identity.buyer_membership_id,
  submitted_by_principal_id: identity.actor_principal_id,
  purchase_reference: cartId,
  market_key: "ZA",
  currency_code: "ZAR",
  agreement_reference: null,
  transaction_digest: "sha256:" + "a".repeat(64),
  resource_version: 1,
  amount_minor: "1000",
  hold_revision: 1,
}

type Case = {
  seller?: Record<string, unknown>[]
  reservation?: Record<string, unknown>[]
  sites?: Record<string, unknown>[]
}
function fixture(overrides: Case = {}) {
  const calls: string[] = []
  const raw = vi.fn(async (sql: string) => {
    calls.push(sql)
    if (sql.includes("pg_current_xact_id()")) return { rows: [{ xid: "1945" }], rowCount: 1 }
    if (sql.includes("FROM native_seller_cart_binding"))
      return { rows: overrides.seller ?? [seller], rowCount: (overrides.seller ?? [seller]).length }
    if (sql.includes("FROM b2b_spend_reservation"))
      return {
        rows: overrides.reservation ?? [reservation],
        rowCount: (overrides.reservation ?? [reservation]).length,
      }
    if (sql.includes("FROM cart c") && sql.includes("JOIN b2b_delivery_site"))
      return {
        rows: overrides.sites ?? [{ id: "b2bsite_registered" }],
        rowCount: (overrides.sites ?? [{ id: "b2bsite_registered" }]).length,
      }
    throw new Error("UNEXPECTED_NATIVE_SQL")
  })
  const orders = {
    baseRepository_: {
      transaction: async (cb: (manager: unknown) => Promise<unknown>) =>
        cb({
          getTransactionContext: () => ({ raw }),
        }),
    },
  } as unknown as IOrderModuleService
  const carts = {
    retrieveCart: vi.fn(async () => {
      throw Error("PRICE_SOURCE_SHOULD_NOT_RUN")
    }),
  }
  const reader = medusaNativeBuyerPurchaseSource({
    orders,
    carts,
    currencyExponent: async () => 2,
    verifyCurrentIssuer: async () => {
      throw Error("CP_ISSUER_NOT_APPROVED")
    },
  })
  return { reader, raw, carts, calls }
}

describe("DEV-07 actual native cart/buyer hold/site source negatives", () => {
  it("does not accept an unknown buyer-cart binding", async () => {
    const t = fixture({ seller: [] })
    await expect(t.reader(identity, cartId)).rejects.toThrow(
      "NATIVE_BUYER_PURCHASE_SOURCE_NOT_PROVEN",
    )
    expect(t.calls.some((s) => s.includes("b2b_spend_reservation"))).toBe(false)
    expect(t.carts.retrieveCart).not.toHaveBeenCalled()
  })
  it("refuses a foreign seller, wrong tenant or ungoverned Market", async () => {
    for (const change of [
      { tenant_id: "tn_foreign" },
      { market_key: "PENDING" },
      { cart_currency: "USD" },
      { cart_customer_id: null },
      { market_code: "za" },
    ]) {
      const t = fixture({ seller: [{ ...seller, ...change }] })
      await expect(t.reader(identity, cartId)).rejects.toThrow()
      expect(t.calls.some((s) => s.includes("b2b_spend_reservation"))).toBe(false)
    }
  })
  it("requires one current Principal-owned reservation, not a Medusa customer claim", async () => {
    for (const rows of [
      [],
      [reservation, reservation],
      [{ ...reservation, submitted_by_principal_id: "cp_another" }],
      [{ ...reservation, market_key: "UG" }],
    ]) {
      const t = fixture({ reservation: rows })
      await expect(t.reader(identity, cartId)).rejects.toThrow()
      expect(t.calls.some((s) => s.includes("JOIN b2b_delivery_site"))).toBe(false)
      expect(t.carts.retrieveCart).not.toHaveBeenCalled()
    }
  })
  it("rejects an absent or ambiguous registered shipping/billing Site", async () => {
    for (const sites of [[], [{ id: "site_1" }, { id: "site_2" }]]) {
      const t = fixture({ sites })
      await expect(t.reader(identity, cartId)).rejects.toThrow()
      expect(t.carts.retrieveCart).not.toHaveBeenCalled()
    }
  })
  it("refuses missing identity or a browser-shaped cart ID before native SQL", async () => {
    const t = fixture()
    await expect(t.reader(identity, "../cart_foreign")).rejects.toThrow()
    await expect(
      t.reader({ ...identity, actor_principal_id: "" }, "cart_someother"),
    ).rejects.toThrow()
    expect(t.calls).toHaveLength(0)
  })
  it("a perfectly scoped native hold and two registered Sites still cannot place an order without final issuer/Cart facts", async () => {
    const t = fixture()
    await expect(t.reader(identity, cartId)).rejects.toThrow("UNEXPECTED_NATIVE_SQL")
    expect(t.calls.some((sql) => sql.includes("FROM native_seller_cart_binding"))).toBe(true)
    const reservationRead = t.calls.find((sql) => sql.includes("FROM b2b_spend_reservation"))
    expect(reservationRead).toContain("deleted_at IS NULL")
    expect(reservationRead).not.toMatch(/FOR (?:SHARE|UPDATE)/)
    expect(t.calls.filter((sql) => sql.includes("JOIN b2b_delivery_site"))).toHaveLength(2)
    expect(t.calls.some((sql) => sql.includes("FROM cart WHERE"))).toBe(true)
  })
  it("requires the issuer checker and native Medusa Cart+Order service", () => {
    expect(() =>
      medusaNativeBuyerPurchaseSource({
        orders: null as never,
        carts: null as never,
        currencyExponent: async () => 2,
        verifyCurrentIssuer: async () => {
          throw Error()
        },
      }),
    ).toThrow()
  })
})
