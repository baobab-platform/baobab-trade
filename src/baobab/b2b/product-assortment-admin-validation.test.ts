import { describe, expect, it } from "vitest"
import {
  validateCanonicalLinkBody,
  validateMarketEligibilityBody,
  validatePurchaseConstraintBody,
  validateTradeProfileBody,
} from "./product-assortment-admin-validation"

describe("ZB-06 admin payload validation", () => {
  it("rejects trade profile with unknown UOM", () => {
    const result = validateTradeProfileBody({
      product_id: "prod_1",
      canonical_product_key: "cp_1",
      country_of_origin: "UG",
      hs_classification_reference: "0901",
      commodity_category: "coffee",
      trade_uom: "WIDGET",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.field).toBe("trade_uom")
  })

  it("accepts trade profile with known UOM and default confidence", () => {
    const result = validateTradeProfileBody({
      product_id: "prod_1",
      canonical_product_key: "cp_1",
      country_of_origin: "UG",
      hs_classification_reference: "0901",
      commodity_category: "coffee",
      trade_uom: "bag",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.trade_uom).toBe("BAG")
      expect(result.data.classification_confidence).toBe("PROPOSED")
    }
  })

  it("rejects market eligibility with invalid regulatory state", () => {
    const result = validateMarketEligibilityBody({
      product_id: "prod_1",
      market_key: "zuribeans_ug",
      regulatory_eligibility: "MAYBE",
    })
    expect(result.ok).toBe(false)
  })

  it("accepts ACTIVE + ELIGIBLE market eligibility", () => {
    const result = validateMarketEligibilityBody({
      product_id: "prod_1",
      market_key: "zuribeans_za",
      status: "ACTIVE",
      regulatory_eligibility: "ELIGIBLE",
    })
    expect(result.ok).toBe(true)
  })

  it("rejects purchase constraint with non-positive MOQ", () => {
    const result = validatePurchaseConstraintBody({
      variant_id: "var_1",
      market_key: "zuribeans_ug",
      minimum_order_quantity: 0,
      order_multiple: 1,
      trade_uom: "KG",
    })
    expect(result.ok).toBe(false)
  })

  it("requires canonical_product_key for link", () => {
    expect(validateCanonicalLinkBody({}).ok).toBe(false)
    expect(validateCanonicalLinkBody({ canonical_product_key: "  cp_x  " }).ok).toBe(true)
  })
})
