import { describe, expect, it, vi } from "vitest"
import { partitionCurrentMarketAssortment } from "../src/baobab/b2b/product-assortment-policy"
import { GET } from "../src/api/store/b2b/assortment/route"
import { PRODUCT_CATALOGUE_ACCESS } from "../src/baobab/catalogue/visibility-authority"

const now = new Date("2026-10-25T12:00:00Z")
const row = { product_id: "prod_a", market_key: "zuribeans_ug", status: "ACTIVE", regulatory_eligibility: "ELIGIBLE" }
const ids = (rows: Parameters<typeof partitionCurrentMarketAssortment>[0], clock = now) =>
  partitionCurrentMarketAssortment(rows, clock).sellable_product_ids

describe("DEV-07 current public assortment", () => {
  it("uses an inclusive start and exclusive end", () => {
    expect(ids([{ ...row, effective_from: now, effective_until: "2026-10-25T12:01:00Z" }])).toEqual(
      [row.product_id],
    )
    expect(ids([{ ...row, effective_until: now }])).toEqual([])
  })
  it.each([
    { effective_from: "2026-10-26T00:00:00Z" },
    { effective_until: "2026-10-24T00:00:00Z" },
    { effective_from: "invalid" },
    { effective_until: "invalid" },
    { effective_from: "2026-10-26T00:00:00Z", effective_until: "2026-10-24T00:00:00Z" },
    { status: "WITHDRAWN" },
    { status: "UNRECOGNISED" },
    { regulatory_eligibility: "NOT_EVALUATED" },
    { regulatory_eligibility: "UNRECOGNISED" },
  ])("refuses stale, malformed or unqualified rows: %j", (change) => {
    expect(ids([{ ...row, ...change }])).toEqual([])
  })
  it("rejects an invalid server clock and ambiguous duplicate products", () => {
    expect(ids([row], new Date("invalid"))).toEqual([])
    expect(ids([row, { ...row, regulatory_eligibility: "INELIGIBLE" }])).toEqual([])
  })
  it.each(["false", "0", "FALSE", "", "typo", ["true", "false"]])(
    "refuses clearance overrides before loading data: %j",
    async (value) => {
      const resolve = vi.fn()
      await expect(
        GET(
          {
            query: { market_key: "zuribeans_ug", require_regulatory_clearance: value },
            scope: { resolve },
          } as never,
          {} as never,
        ),
      ).rejects.toThrow(/clearance is mandatory/)
      expect(resolve).not.toHaveBeenCalled()
    },
  )
  it("uses strict clearance and no-store on successful reads", async () => {
    const list = vi
      .fn()
      .mockResolvedValue([
        row,
        { ...row, product_id: "prod_b", regulatory_eligibility: "NOT_EVALUATED" },
      ])
    let payload: unknown
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: (value: unknown) => {
        payload = value
      },
    }
    const accessPort = {
      authorizeRequest: vi.fn(async () => ({
        tenantId: "tn_zuribeans",
        canonicalMarketId: "mkt_zuribeans_ug",
        marketKey: "zuribeans_ug",
        digitalEstateId: "estate:zuribeans",
        buyerPrincipalId: "principal_1",
        canonicalBuyerOrganisationId: "buyer_org_1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })),
      visibleProductIds: vi.fn(async (_scope: unknown, eligible: string[]) => eligible),
    }
    await GET(
      {
        query: { market_key: "zuribeans_ug" },
        scope: {
          resolve: (key: string) =>
            key === PRODUCT_CATALOGUE_ACCESS
              ? accessPort
              : { listMarketProductEligibilities: list },
        },
      } as never,
      res as never,
    )
    expect(list).toHaveBeenCalledWith({ market_key: "zuribeans_ug" }, { take: 500 })
    expect(payload).toMatchObject({
      require_regulatory_clearance: true,
      sellable_product_ids: [row.product_id],
    })
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
    expect(accessPort.authorizeRequest).toHaveBeenCalledOnce()
    expect(accessPort.visibleProductIds).toHaveBeenCalledOnce()
    expect(payload).not.toHaveProperty("blocked")
    expect(payload).not.toHaveProperty("counts")
  })
})
