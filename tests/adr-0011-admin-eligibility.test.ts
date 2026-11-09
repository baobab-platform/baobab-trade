import { describe, expect, it, vi } from "vitest"
import { POST } from "../src/api/admin/b2b/market-product-eligibility/route"
import { validateMarketEligibilityBody } from "../src/baobab/b2b/product-assortment-admin-validation"

const valid = {
  product_id: "prod_za",
  market_key: "zuribeans_za",
  status: "ACTIVE",
  regulatory_eligibility: "ELIGIBLE",
  policy_reference: "policy:za-wholesale-v1",
  effective_from: "2026-11-09T08:00:00Z",
  effective_until: "2026-12-09T08:00:00Z",
}
const record = {
  ...valid,
  id: "b2belig_1",
  effective_from: new Date(valid.effective_from),
  effective_until: new Date(valid.effective_until),
}

const response = () => {
  const res = {
    code: 0,
    body: null as unknown,
    status(code: number) {
      res.code = code
      return res
    },
    json(value: unknown) {
      res.body = value
      return res
    },
  }
  return res
}

const service = (rows: Record<string, unknown>[] = []) => ({
  listMarketProductEligibilities: vi.fn(async () => rows),
  updateMarketProductEligibilities: vi.fn(async (input: Record<string, unknown>) => ({
    ...record,
    ...input,
  })),
  createMarketProductEligibilities: vi.fn(async (input: Record<string, unknown>) => ({
    ...record,
    ...input,
  })),
})

const request = (b2b: ReturnType<typeof service>, body: Record<string, unknown> = valid) => ({
  body,
  scope: { resolve: vi.fn(() => b2b) },
})

describe("ADR-0011 Market assortment administrative mutation boundaries", () => {
  it.each([
    ["non-ISO date", { effective_from: "November 9, 2026" }],
    ["missing timezone", { effective_from: "2026-11-09T08:00:00" }],
    ["invalid effective-from", { effective_from: "invalid" }],
    ["invalid effective-until", { effective_until: "not a timestamp" }],
    ["wrong type", { effective_from: 1762675200000 }],
    ["reversed window", { effective_from: "2026-12-20T08:00:00Z" }],
    ["zero-length window", { effective_until: "2026-11-09T08:00:00Z" }],
    ["ambiguous policy", { policy_reference: "  " }],
    ["bad policy type", { policy_reference: 17 }],
  ])("refuses %s before any data access", async (_name, override) => {
    const b2b = service()
    const req = request(b2b, { ...valid, ...override })
    await expect(POST(req as never, response() as never)).rejects.toThrow()
    expect(req.scope.resolve).not.toHaveBeenCalled()
    expect(b2b.listMarketProductEligibilities).not.toHaveBeenCalled()
    expect(b2b.updateMarketProductEligibilities).not.toHaveBeenCalled()
    expect(b2b.createMarketProductEligibilities).not.toHaveBeenCalled()
  })

  it("rejects an existing row belonging to a different Market even if a source ignores filters", async () => {
    const b2b = service([{ ...record, market_key: "zuribeans_ug" }])
    await expect(POST(request(b2b) as never, response() as never)).rejects.toThrow(
      "Ambiguous product Market eligibility",
    )
    expect(b2b.updateMarketProductEligibilities).not.toHaveBeenCalled()
    expect(b2b.createMarketProductEligibilities).not.toHaveBeenCalled()
  })

  it("rejects an existing row belonging to a different Product and never updates it", async () => {
    const b2b = service([{ ...record, product_id: "prod_other" }])
    await expect(POST(request(b2b) as never, response() as never)).rejects.toThrow(
      "Ambiguous product Market eligibility",
    )
    expect(b2b.updateMarketProductEligibilities).not.toHaveBeenCalled()
  })

  it("refuses two rows for the same scoped Product/Market instead of adopting the first", async () => {
    const b2b = service([record, { ...record, id: "b2belig_2" }])
    await expect(POST(request(b2b) as never, response() as never)).rejects.toThrow(
      "Ambiguous product Market eligibility",
    )
    expect(b2b.updateMarketProductEligibilities).not.toHaveBeenCalled()
  })

  it("updates exactly the current scoped row with validated Date objects and no foreign payload", async () => {
    const b2b = service([record])
    const res = response()
    await POST(request(b2b) as never, res as never)
    expect(b2b.listMarketProductEligibilities).toHaveBeenCalledWith(
      { product_id: "prod_za", market_key: "zuribeans_za" },
      { take: 2 },
    )
    expect(b2b.updateMarketProductEligibilities).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "b2belig_1",
        product_id: "prod_za",
        market_key: "zuribeans_za",
        policy_reference: "policy:za-wholesale-v1",
        effective_from: new Date(valid.effective_from),
        effective_until: new Date(valid.effective_until),
      }),
    )
    expect(res.code).toBe(200)
    expect(b2b.createMarketProductEligibilities).not.toHaveBeenCalled()
  })

  it("creates one scoped record when absent but does not mistake it for CP product authorization", async () => {
    const b2b = service()
    const res = response()
    await POST(request(b2b) as never, res as never)
    expect(b2b.createMarketProductEligibilities).toHaveBeenCalledOnce()
    expect(b2b.updateMarketProductEligibilities).not.toHaveBeenCalled()
    expect(res.code).toBe(201)
  })

  it("allows explicitly unbounded dates and rejects a policy-controlled unknown status", () => {
    const allowed = validateMarketEligibilityBody({
      product_id: "prod_za",
      market_key: "zuribeans_za",
      effective_from: null,
      effective_until: null,
    })
    expect(allowed.ok).toBe(true)
    if (allowed.ok) {
      expect(allowed.data.effective_from).toBeNull()
      expect(allowed.data.effective_until).toBeNull()
    }
    expect(
      validateMarketEligibilityBody({
        product_id: "prod_za",
        market_key: "zuribeans_za",
        status: "UNRECOGNISED",
      }).ok,
    ).toBe(false)
  })
})
