import { describe, expect, it, vi } from "vitest"
import { resolveCommerceContext } from "../src/baobab/context/resolver"
import type { ControlPlaneClient } from "../src/baobab/control-plane/client"
import type { MappingResolutionResponse } from "../src/baobab/contracts/canonical-mapping"
import type { BaobabMarket } from "../src/baobab/contracts/market"
import type { BaobabTenantContext } from "../src/baobab/contracts/tenant-context"

const tenant: BaobabTenantContext = {
  tenantId: "tn_zuribeans",
  entityId: "ZURIBEANS",
  lifecycleStatus: "active",
  productId: "baobab-trade",
  entitled: true,
  entitlementTier: null,
  cacheTtlSeconds: 15,
  resolvedAt: "2026-09-07T10:00:00Z",
  correlationId: "7c8f131b-d8ba-4d89-b60b-a187d3944074",
}

const market: BaobabMarket = {
  market_id: "zuribeans_za_b2b",
  canonical_key: "zuribeans.za.b2b",
  name: "ZuriBeans South Africa B2B",
  owner_tenant_id: tenant.tenantId,
  legal_entity_id: "ZURIBEANS-ZA",
  market_type: "B2B",
  status: "ACTIVE",
  effective_from: "2026-09-07T00:00:00Z",
  revision: 1,
}

const mapping = (canonicalEntityId: string, suffix: string): MappingResolutionResponse => ({
  mapping_id: `map_${suffix}`,
  canonical_entity_id: canonicalEntityId,
  external_reference_id: `ref_${suffix}`,
  status: "ACTIVE",
  resolution_reason: "scope_matched",
  effective_timestamp: "2026-09-07T10:00:00Z",
})

const clientFor = (resolvedMarket = market): ControlPlaneClient => ({
  resolveContext: vi.fn().mockResolvedValue(tenant),
  getMarket: vi.fn().mockResolvedValue(resolvedMarket),
  resolveMapping: vi
    .fn()
    .mockImplementation((request) =>
      Promise.resolve(
        mapping(
          request.canonical_entity_id,
          request.canonical_entity_id.toLowerCase().replaceAll("-", ""),
        ),
      ),
    ),
  resolvePlatformContext: vi.fn(),
})

describe("Baobab commerce context isolation", () => {
  it("resolves Market, Legal Seller, Digital Estate, canonical IDs and external references", async () => {
    const client = clientFor()
    const context = await resolveCommerceContext(
      client,
      { marketId: market.market_id, digitalEstateCanonicalId: "estate:zuribeans-b2b" },
      "access-token",
      "corr-1",
    )

    expect(context.tenant.tenantId).toBe("tn_zuribeans")
    expect(context.legalSellerCanonicalId).toBe("ZURIBEANS-ZA")
    expect(context.digitalEstateCanonicalId).toBe("estate:zuribeans-b2b")
    expect(context.externalReferences.market.external_reference_id).toMatch(/^ref_/)
    expect(client.resolveMapping).toHaveBeenCalledTimes(3)
  })

  it("rejects a Market owned by another tenant before resolving any mappings", async () => {
    const client = clientFor({ ...market, owner_tenant_id: "tn_thamani" })

    await expect(
      resolveCommerceContext(
        client,
        { marketId: market.market_id, digitalEstateCanonicalId: "estate:zuribeans-b2b" },
        "access-token",
        "corr-1",
      ),
    ).rejects.toThrow("outside the authenticated tenant boundary")
    expect(client.resolveMapping).not.toHaveBeenCalled()
  })

  it("rejects an inactive Market and a missing Legal Seller", async () => {
    await expect(
      resolveCommerceContext(
        clientFor({ ...market, status: "SUSPENDED" }),
        { marketId: market.market_id, digitalEstateCanonicalId: "estate:zuribeans-b2b" },
        "access-token",
        "corr-1",
      ),
    ).rejects.toThrow("not ACTIVE")

    await expect(
      resolveCommerceContext(
        clientFor({ ...market, legal_entity_id: null }),
        { marketId: market.market_id, digitalEstateCanonicalId: "estate:zuribeans-b2b" },
        "access-token",
        "corr-1",
      ),
    ).rejects.toThrow("no valid Legal Seller")
  })
})
