import { describe, expect, it } from "vitest"
import {
  assertMarketEligibility,
  assertOrderQuantity,
  MedusaPricingDecisionAdapter,
  selectPrice,
  type PriceCandidate,
  type PriceCandidateProvider,
} from "../src/baobab/pricing"

const request = {
  variantId: "variant-aa",
  marketKey: "zuribeans_za",
  organisationId: "org-a",
  currencyCode: "zar",
  quantity: 20,
}

const candidates: PriceCandidate[] = [
  { kind: "STANDARD_WHOLESALE", amount: 6_150, currencyCode: "zar" },
  { kind: "VOLUME", amount: 5_950, currencyCode: "zar", minQuantity: 5, maxQuantity: 19 },
  { kind: "VOLUME", amount: 5_700, currencyCode: "zar", minQuantity: 20 },
  {
    kind: "CONTRACT",
    amount: 5_500,
    currencyCode: "zar",
    minQuantity: 20,
    organisationId: "org-a",
  },
]

describe("PricingDecisionPort policy", () => {
  it("prefers an authorised organisation contract price over volume and standard pricing", () => {
    expect(selectPrice(request, candidates)).toMatchObject({ kind: "CONTRACT", amount: 5_500 })
  })

  it("never leaks another organisation's contract price", () => {
    expect(selectPrice({ ...request, organisationId: "org-b" }, candidates)).toMatchObject({
      kind: "VOLUME",
      amount: 5_700,
    })
  })

  it("resolves quantity tiers deterministically", () => {
    expect(selectPrice({ ...request, quantity: 4 }, candidates)).toMatchObject({
      kind: "STANDARD_WHOLESALE",
    })
    expect(selectPrice({ ...request, quantity: 10 }, candidates)).toMatchObject({
      kind: "VOLUME",
      amount: 5_950,
    })
  })

  it("enforces MOQ and order multiples", () => {
    expect(() => assertOrderQuantity(3, 2, 2)).toThrow("multiples of 2")
    expect(() => assertOrderQuantity(4, 2, 2)).not.toThrow()
  })

  it("fails closed for absent or suspended Market eligibility", () => {
    expect(() =>
      assertMarketEligibility("zuribeans_za", { marketKey: "zuribeans_ug", status: "ACTIVE" }),
    ).toThrow("not eligible")
    expect(() =>
      assertMarketEligibility("zuribeans_za", { marketKey: "zuribeans_za", status: "SUSPENDED" }),
    ).toThrow("not eligible")
  })
})

describe("PricingDecisionPort contract (MedusaPricingDecisionAdapter)", () => {
  class StaticCandidateProvider implements PriceCandidateProvider {
    constructor(private readonly candidates: PriceCandidate[]) {}
    async listCandidates() {
      return this.candidates
    }
  }

  it("decides the same authorised price selectPrice would pick from the provided candidates", async () => {
    const adapter = new MedusaPricingDecisionAdapter(new StaticCandidateProvider(candidates))
    expect(await adapter.decide(request)).toMatchObject({ kind: "CONTRACT", amount: 5_500 })
  })

  it("propagates a fail-closed rejection when no candidate is eligible", async () => {
    const adapter = new MedusaPricingDecisionAdapter(new StaticCandidateProvider([]))
    await expect(adapter.decide(request)).rejects.toThrow("No authorised price")
  })
})
