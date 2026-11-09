import { describe, expect, it, vi } from "vitest"
import { GET } from "../src/api/store/b2b/assortment/route"
import {
  PRODUCT_CATALOGUE_ACCESS,
  assertVerifiedCatalogueAccess,
  assertVisibleProductSubset,
  type VerifiedCatalogueAccess,
} from "../src/baobab/catalogue/visibility-authority"

const permitted = {
  product_id: "prod_public",
  market_key: "zuribeans_za",
  status: "ACTIVE",
  regulatory_eligibility: "ELIGIBLE",
}
const restricted = { ...permitted, product_id: "prod_confidential" }
const blocked = {
  ...permitted,
  product_id: "prod_blocked",
  regulatory_eligibility: "INELIGIBLE",
}
const otherMarket = { ...permitted, product_id: "prod_other_market", market_key: "zuribeans_ug" }

function access(
  overrides: Partial<VerifiedCatalogueAccess> = {},
): VerifiedCatalogueAccess {
  return {
    tenantId: "tn_zuribeans",
    canonicalMarketId: "mkt_zuribeans_za",
    marketKey: "zuribeans_za",
    digitalEstateId: "estate:zuribeans",
    buyerPrincipalId: "principal_alice",
    canonicalBuyerOrganisationId: "org_alice",
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    ...overrides,
  }
}

function request(
  service: { listMarketProductEligibilities: ReturnType<typeof vi.fn> },
  port?: {
    authorizeRequest: ReturnType<typeof vi.fn>
    visibleProductIds: ReturnType<typeof vi.fn>
  },
  query: Record<string, unknown> = { market_key: "zuribeans_za" },
) {
  const scope = {
    resolve: vi.fn((key: string) => {
      if (key === PRODUCT_CATALOGUE_ACCESS) {
        if (!port) throw new Error("catalogue authority not registered")
        return port
      }
      return service
    }),
  }
  return { req: { query, scope }, scope }
}

function response() {
  const result = {
    body: null as unknown,
    code: 0,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      result.headers[name.toLowerCase()] = value
      return result
    },
    status(code: number) {
      result.code = code
      return result
    },
    json(value: unknown) {
      result.body = value
      return result
    },
  }
  return result
}

describe("ADR-0011 B2B assortment Market and organisation confidentiality", () => {
  it("refuses anonymous/unverified catalogue requests BEFORE reading eligibility rows", async () => {
    const service = { listMarketProductEligibilities: vi.fn() }
    const { req, scope } = request(service)
    const res = response()
    await expect(GET(req as never, res as never)).rejects.toThrow("B2B catalogue unavailable")
    expect(service.listMarketProductEligibilities).not.toHaveBeenCalled()
    expect(scope.resolve).toHaveBeenCalledWith(PRODUCT_CATALOGUE_ACCESS)
    expect(res.headers["cache-control"]).toBe("no-store")
  })

  it("refuses a client-selected Market that CP did not attest", async () => {
    const service = { listMarketProductEligibilities: vi.fn() }
    const port = {
      authorizeRequest: vi.fn(async () => access({ marketKey: "zuribeans_ug" })),
      visibleProductIds: vi.fn(),
    }
    const { req } = request(service, port)
    await expect(GET(req as never, response() as never)).rejects.toThrow(
      "B2B catalogue unavailable",
    )
    expect(service.listMarketProductEligibilities).not.toHaveBeenCalled()
    expect(port.visibleProductIds).not.toHaveBeenCalled()
  })

  it("refuses stale or incomplete buyer authority, regardless of the requested Market key", async () => {
    for (const change of [
      { expiresAt: "2020-01-01T00:00:00Z" },
      { tenantId: "" },
      { canonicalMarketId: "" },
      { buyerPrincipalId: "" },
      { canonicalBuyerOrganisationId: "" },
      { digitalEstateId: "" },
    ]) {
      const service = { listMarketProductEligibilities: vi.fn() }
      const port = {
        authorizeRequest: vi.fn(async () => access(change)),
        visibleProductIds: vi.fn(),
      }
      const { req } = request(service, port)
      await expect(GET(req as never, response() as never)).rejects.toThrow(
        "B2B catalogue unavailable",
      )
      expect(service.listMarketProductEligibilities).not.toHaveBeenCalled()
    }
  })

  it("does not leak blocked diagnostics, regulatory status or other-Market source rows", async () => {
    const service = {
      listMarketProductEligibilities: vi.fn(async () => [
        permitted,
        blocked,
        otherMarket,
      ]),
    }
    const port = {
      authorizeRequest: vi.fn(async () => access()),
      visibleProductIds: vi.fn(async (_scope: unknown, eligible: string[]) => eligible),
    }
    const { req } = request(service, port)
    const res = response()
    await GET(req as never, res as never)
    expect(service.listMarketProductEligibilities).toHaveBeenCalledWith(
      { market_key: "zuribeans_za" },
      { take: 500 },
    )
    expect(port.visibleProductIds).toHaveBeenCalledWith(
      expect.objectContaining({ canonicalBuyerOrganisationId: "org_alice" }),
      ["prod_public"],
    )
    expect(res.body).toEqual({
      market_key: "zuribeans_za",
      require_regulatory_clearance: true,
      sellable_product_ids: ["prod_public"],
    })
    expect(JSON.stringify(res.body)).not.toMatch(/prod_blocked|prod_other_market|INELIGIBLE/)
    expect(res.headers["cache-control"]).toBe("no-store")
  })

  it("keeps Organisation A's exclusive catalogue hidden from Organisation B", async () => {
    const service = {
      listMarketProductEligibilities: vi.fn(async () => [permitted, restricted]),
    }
    const port = {
      authorizeRequest: vi.fn(async (req: { organisation: string }) =>
        access({ canonicalBuyerOrganisationId: req.organisation }),
      ),
      visibleProductIds: vi.fn(async (scope: VerifiedCatalogueAccess) =>
        scope.canonicalBuyerOrganisationId === "org_alice"
          ? ["prod_public", "prod_confidential"]
          : ["prod_public"],
      ),
    }
    for (const [organisation, expected] of [
      ["org_alice", ["prod_public", "prod_confidential"]],
      ["org_bob", ["prod_public"]],
    ] as const) {
      const { req } = request(service, port)
      const res = response()
      await GET({ ...req, organisation } as never, res as never)
      expect((res.body as { sellable_product_ids: string[] }).sellable_product_ids).toEqual(expected)
      if (organisation === "org_bob") {
        expect(JSON.stringify(res.body)).not.toContain("prod_confidential")
      }
    }
  })

  it("fails closed if an entitlement provider includes blocked, off-Market or unknown IDs", async () => {
    for (const extra of ["prod_blocked", "prod_other_market", "prod_unknown"]) {
      const service = {
        listMarketProductEligibilities: vi.fn(async () => [permitted, blocked, otherMarket]),
      }
      const port = {
        authorizeRequest: vi.fn(async () => access()),
        visibleProductIds: vi.fn(async () => ["prod_public", extra]),
      }
      const { req } = request(service, port)
      const res = response()
      await expect(GET(req as never, res as never)).rejects.toThrow(
        "B2B catalogue unavailable",
      )
      expect(res.body).toBeNull()
    }
  })

  it("rejects duplicates, malformed results and provider expansion of candidate IDs", () => {
    for (const visible of [
      ["prod_public", "prod_public"],
      ["prod_public", "prod_other"],
      [""],
      ["prod_public", "prod_public", "prod_public"],
      null,
    ]) {
      expect(() => assertVisibleProductSubset(["prod_public"], visible as never)).toThrow(
        /catalogue|disclosure/,
      )
    }
  })

  it("requires a valid Market/tenant identity and current buyer-specific authority", () => {
    const current = access()
    expect(assertVerifiedCatalogueAccess(current, current.marketKey)).toEqual(current)
    expect(() =>
      assertVerifiedCatalogueAccess(current, "zuribeans_ug"),
    ).toThrow(/not authorised/)
    expect(() => assertVerifiedCatalogueAccess(access({ tenantId: "thamani" }), "zuribeans_za"))
      .toThrow(/not authorised/)
  })

  it("cannot let browser query parameters disable regulatory clearance", async () => {
    const service = { listMarketProductEligibilities: vi.fn() }
    const port = {
      authorizeRequest: vi.fn(async () => access()),
      visibleProductIds: vi.fn(),
    }
    const { req } = request(
      service,
      port,
      { market_key: "zuribeans_za", require_regulatory_clearance: "false" },
    )
    await expect(GET(req as never, response() as never)).rejects.toThrow(
      "regulatory clearance is mandatory",
    )
    expect(port.authorizeRequest).not.toHaveBeenCalled()
    expect(service.listMarketProductEligibilities).not.toHaveBeenCalled()
  })
})
