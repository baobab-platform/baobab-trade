import { describe, expect, it } from "vitest"
import {
  classificationAllowsAutomatedTrade,
  isAssortmentActive,
  isKnownTradeUom,
  isMarketAssortmentSellable,
  isRegulatoryBlocking,
  isRegulatoryPermissive,
  normalizeTradeUom,
} from "./product-assortment-policy"

describe("product-assortment-policy", () => {
  it("treats only ACTIVE as assortment-active", () => {
    expect(isAssortmentActive("ACTIVE")).toBe(true)
    expect(isAssortmentActive("SUSPENDED")).toBe(false)
    expect(isAssortmentActive("WITHDRAWN")).toBe(false)
  })

  it("fails closed on unevaluated and blocking regulatory states", () => {
    expect(isRegulatoryBlocking("NOT_EVALUATED")).toBe(true)
    expect(isRegulatoryBlocking("PENDING")).toBe(true)
    expect(isRegulatoryBlocking("INELIGIBLE")).toBe(true)
    expect(isRegulatoryBlocking("ELIGIBLE")).toBe(false)
  })

  it("does not treat catalogue ACTIVE as sellable without regulatory clearance", () => {
    expect(
      isMarketAssortmentSellable({
        assortmentStatus: "ACTIVE",
        regulatoryEligibility: "NOT_EVALUATED",
        requireRegulatoryClearance: true,
      }),
    ).toBe(false)
    expect(
      isMarketAssortmentSellable({
        assortmentStatus: "ACTIVE",
        regulatoryEligibility: "ELIGIBLE",
        requireRegulatoryClearance: true,
      }),
    ).toBe(true)
  })

  it("allows ELIGIBLE_WITH_CONDITIONS as permissive", () => {
    expect(isRegulatoryPermissive("ELIGIBLE_WITH_CONDITIONS")).toBe(true)
  })

  it("requires verified classification for automated trade", () => {
    expect(classificationAllowsAutomatedTrade("PROPOSED")).toBe(false)
    expect(classificationAllowsAutomatedTrade("VERIFIED")).toBe(true)
    expect(classificationAllowsAutomatedTrade("AUTHORITATIVE")).toBe(true)
  })

  it("normalises trade UOM without product-specific branches", () => {
    expect(normalizeTradeUom(" kg ")).toBe("KG")
    expect(isKnownTradeUom("BAG")).toBe(true)
    expect(isKnownTradeUom("LITRE")).toBe(true)
    expect(isKnownTradeUom("WIDGET")).toBe(false)
  })
})
