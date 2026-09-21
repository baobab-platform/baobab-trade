import { describe, expect, it } from "vitest"
import {
  classificationAllowsAutomatedTrade,
  isAssortmentActive,
  isKnownTradeUom,
  isMarketAssortmentSellable,
  isRegulatoryBlocking,
  isRegulatoryPermissive,
  normalizeTradeUom,
  partitionMarketAssortment,
  type CommercialAssortmentStatus,
  type RegulatoryEligibility,
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
    expect(isRegulatoryBlocking("REVIEW_REQUIRED")).toBe(true)
    expect(isRegulatoryBlocking("INELIGIBLE")).toBe(true)
    expect(isRegulatoryBlocking("SUSPENDED")).toBe(true)
    expect(isRegulatoryBlocking("EXPIRED")).toBe(true)
    expect(isRegulatoryBlocking("ERROR")).toBe(true)
    expect(isRegulatoryBlocking("ELIGIBLE")).toBe(false)
    expect(isRegulatoryBlocking("ELIGIBLE_WITH_CONDITIONS")).toBe(false)
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

  it("sellability matrix: ACTIVE required under strict clearance", () => {
    const statuses: CommercialAssortmentStatus[] = ["ACTIVE", "SUSPENDED", "WITHDRAWN"]
    const regs: RegulatoryEligibility[] = [
      "NOT_EVALUATED",
      "PENDING",
      "ELIGIBLE",
      "ELIGIBLE_WITH_CONDITIONS",
      "REVIEW_REQUIRED",
      "INELIGIBLE",
      "SUSPENDED",
      "EXPIRED",
      "ERROR",
    ]

    for (const status of statuses) {
      for (const reg of regs) {
        const sellable = isMarketAssortmentSellable({
          assortmentStatus: status,
          regulatoryEligibility: reg,
          requireRegulatoryClearance: true,
        })
        const expected =
          status === "ACTIVE" && (reg === "ELIGIBLE" || reg === "ELIGIBLE_WITH_CONDITIONS")
        expect(sellable).toBe(expected)
      }
    }
  })

  it("soft clearance still blocks hard regulatory negatives", () => {
    expect(
      isMarketAssortmentSellable({
        assortmentStatus: "ACTIVE",
        regulatoryEligibility: "INELIGIBLE",
        requireRegulatoryClearance: false,
      }),
    ).toBe(false)
    expect(
      isMarketAssortmentSellable({
        assortmentStatus: "ACTIVE",
        regulatoryEligibility: "NOT_EVALUATED",
        requireRegulatoryClearance: false,
      }),
    ).toBe(true)
    expect(
      isMarketAssortmentSellable({
        assortmentStatus: "SUSPENDED",
        regulatoryEligibility: "ELIGIBLE",
        requireRegulatoryClearance: false,
      }),
    ).toBe(false)
  })

  it("allows ELIGIBLE_WITH_CONDITIONS as permissive", () => {
    expect(isRegulatoryPermissive("ELIGIBLE_WITH_CONDITIONS")).toBe(true)
  })

  it("requires verified classification for automated trade", () => {
    expect(classificationAllowsAutomatedTrade("PROPOSED")).toBe(false)
    expect(classificationAllowsAutomatedTrade("UNDER_REVIEW")).toBe(false)
    expect(classificationAllowsAutomatedTrade("DISPUTED")).toBe(false)
    expect(classificationAllowsAutomatedTrade("EXPIRED")).toBe(false)
    expect(classificationAllowsAutomatedTrade("VERIFIED")).toBe(true)
    expect(classificationAllowsAutomatedTrade("AUTHORITATIVE")).toBe(true)
  })

  it("normalises trade UOM without product-specific branches", () => {
    expect(normalizeTradeUom(" kg ")).toBe("KG")
    expect(isKnownTradeUom("BAG")).toBe(true)
    expect(isKnownTradeUom("LITRE")).toBe(true)
    expect(isKnownTradeUom("WIDGET")).toBe(false)
  })

  it("supports purchase-constraint UOM codes used for wine and coffee packaging", () => {
    for (const uom of ["BAG", "CARTON", "BOTTLE", "LITRE", "TONNE", "PALLET"]) {
      expect(isKnownTradeUom(uom)).toBe(true)
    }
  })

  it("partitions market rows into sellable ids and blocked diagnostics", () => {
    const partition = partitionMarketAssortment(
      [
        { product_id: "prod_ok", status: "ACTIVE", regulatory_eligibility: "ELIGIBLE" },
        {
          product_id: "prod_conditions",
          status: "ACTIVE",
          regulatory_eligibility: "ELIGIBLE_WITH_CONDITIONS",
        },
        {
          product_id: "prod_uneval",
          status: "ACTIVE",
          regulatory_eligibility: "NOT_EVALUATED",
        },
        {
          product_id: "prod_suspended",
          status: "SUSPENDED",
          regulatory_eligibility: "ELIGIBLE",
        },
      ],
      { requireRegulatoryClearance: true },
    )

    expect(partition.sellable_product_ids).toEqual(["prod_ok", "prod_conditions"])
    expect(partition.blocked.map((b) => b.product_id).sort()).toEqual([
      "prod_suspended",
      "prod_uneval",
    ])
    expect(partition.counts).toEqual({ evaluated: 4, sellable: 2, blocked: 2 })
  })

  it("partition soft mode includes NOT_EVALUATED when commercially ACTIVE", () => {
    const partition = partitionMarketAssortment(
      [
        {
          product_id: "prod_uneval",
          status: "ACTIVE",
          regulatory_eligibility: "NOT_EVALUATED",
        },
        {
          product_id: "prod_bad",
          status: "ACTIVE",
          regulatory_eligibility: "INELIGIBLE",
        },
      ],
      { requireRegulatoryClearance: false },
    )
    expect(partition.sellable_product_ids).toEqual(["prod_uneval"])
    expect(partition.blocked).toEqual([
      {
        product_id: "prod_bad",
        status: "SUSPENDED".replace("SUSPENDED", "ACTIVE"),
        regulatory_eligibility: "INELIGIBLE",
      },
    ])
    // blocked row keeps original status ACTIVE
    expect(partition.blocked[0].status).toBe("ACTIVE")
  })
})
