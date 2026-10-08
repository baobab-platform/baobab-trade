import { describe, expect, it } from "vitest"
import {
  assertPromotionCurrencyMatchesCart,
  findThamaniPromotionConfig,
  THAMANI_PROMOTIONS,
  THAMANI_SALES_CHANNEL_KEY,
  ThamaniCartEstateMismatchError,
  ThamaniPromotionCurrencyMismatchError,
} from "../src/baobab/thamani/promotions/promotion-config"
import {
  assertExclusivePromotionStacking,
  ThamaniPromotionStackingViolationError,
} from "../src/baobab/thamani/promotions/stacking-policy"

describe("THAMANI_PROMOTIONS fixture", () => {
  it("declares one percentage and one fixed promotion, with distinct codes", () => {
    const types = THAMANI_PROMOTIONS.map((promotion) => promotion.applicationType)
    expect(new Set(types)).toEqual(new Set(["percentage", "fixed"]))
    const codes = THAMANI_PROMOTIONS.map((promotion) => promotion.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("gives every promotion a positive value", () => {
    for (const promotion of THAMANI_PROMOTIONS) {
      expect(promotion.value).toBeGreaterThan(0)
    }
  })
})

describe("findThamaniPromotionConfig", () => {
  it("finds a known code", () => {
    expect(findThamaniPromotionConfig("THAMANI10")?.applicationType).toBe("percentage")
  })

  it("returns undefined for an unknown code", () => {
    expect(findThamaniPromotionConfig("NOT-A-REAL-CODE")).toBeUndefined()
  })
})

describe("assertPromotionCurrencyMatchesCart", () => {
  const promotion = { code: "THAMANI10", currencyCode: "ugx" as const }

  it("allows a cart in the promotion's own currency, case-insensitively", () => {
    expect(() => assertPromotionCurrencyMatchesCart(promotion, "ugx")).not.toThrow()
    expect(() => assertPromotionCurrencyMatchesCart(promotion, "UGX")).not.toThrow()
  })

  it("fails closed when the cart's currency does not match — the financial-defect scenario ADR-0012 §32 warns about", () => {
    expect(() => assertPromotionCurrencyMatchesCart(promotion, "zar")).toThrow(
      ThamaniPromotionCurrencyMismatchError,
    )
  })
})

describe("THAMANI_SALES_CHANNEL_KEY", () => {
  it("is the breadcrumb bootstrap-thamani-market.ts tags the Sales Channel with", () => {
    expect(THAMANI_SALES_CHANNEL_KEY).toBe("thamani_b2c")
  })
})

describe("ThamaniCartEstateMismatchError", () => {
  it("names the code and the cart's sales channel — currency alone is never sufficient to identify a Thamani cart", () => {
    const error = new ThamaniCartEstateMismatchError("THAMANI10", "sc_zuribeans_ug")
    expect(error.code).toBe("THAMANI10")
    expect(error.cartSalesChannelId).toBe("sc_zuribeans_ug")
    expect(error.message).toContain("THAMANI10")
    expect(error.message).toContain("sc_zuribeans_ug")
  })

  it("handles a cart with no sales channel at all", () => {
    const error = new ThamaniCartEstateMismatchError("THAMANI10", null)
    expect(error.message).toContain("none")
  })
})

describe("assertExclusivePromotionStacking", () => {
  it("allows applying the first promotion to an empty cart", () => {
    expect(() => assertExclusivePromotionStacking([], "THAMANI10")).not.toThrow()
  })

  it("is a no-op re-applying the same code already on the cart", () => {
    expect(() => assertExclusivePromotionStacking(["THAMANI10"], "THAMANI10")).not.toThrow()
  })

  it("fails closed when a different promotion is already applied — the exclusive stacking policy", () => {
    expect(() => assertExclusivePromotionStacking(["THAMANI10"], "THAMANIFIXED2000")).toThrow(
      ThamaniPromotionStackingViolationError,
    )
  })
})
