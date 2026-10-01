import { describe, expect, it, vi } from "vitest"
import { resolveCommerceContext } from "../src/baobab/context/resolver"
import type { ControlPlaneClient } from "../src/baobab/control-plane/client"
import type { MappingResolutionResponse } from "../src/baobab/contracts/canonical-mapping"
import type { RawPlatformContextResolutionResponse } from "../src/baobab/contracts/platform-context"
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

const storedContext: RawPlatformContextResolutionResponse = {
  context_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b",
  tenant_id: tenant.tenantId,
  resolved_at: "2026-09-07T10:00:00Z",
  market_id: market.market_id,
}

const mapping = (
  canonicalEntityId: string,
  suffix: string,
  overrides: Record<string, unknown> = {},
): MappingResolutionResponse =>
  ({
    context_id: storedContext.context_id,
    tenant_id: tenant.tenantId,
    mapping_id: `map_${suffix}`,
    canonical_entity_id: canonicalEntityId,
    external_reference_id: `ref_${suffix}`,
    status: "ACTIVE",
    resolution_reason: "scope_matched",
    effective_timestamp: "2026-09-07T10:00:00Z",
    mapping_version: 1,
    resolved_at: "2026-09-07T10:00:01Z",
    ...overrides,
  }) as MappingResolutionResponse

const clientFor = (
  resolvedMarket = market,
  stored: RawPlatformContextResolutionResponse = storedContext,
  mappingOverrides: Record<string, unknown> = {},
): ControlPlaneClient => ({
  resolveContext: vi.fn().mockResolvedValue(tenant),
  getMarket: vi.fn().mockResolvedValue(resolvedMarket),
  resolveStoredContext: vi.fn().mockResolvedValue(stored),
  resolveMapping: vi
    .fn()
    .mockImplementation((request) =>
      Promise.resolve(
        mapping(
          request.canonical_entity_id,
          request.canonical_entity_id.toLowerCase().replace(/[^a-z0-9]/g, ""),
          mappingOverrides,
        ),
      ),
    ),
  resolvePlatformContext: vi.fn(),
})

const selection = { marketId: market.market_id, digitalEstateCanonicalId: "estate:zuribeans-b2b" }

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

  it("redeems one stored context for every mapping and supplies no scope of its own (ADR-SHARED-014)", async () => {
    const client = clientFor()
    const context = await resolveCommerceContext(client, selection, "access-token", "corr-1")

    expect(context.contextId).toBe(storedContext.context_id)
    const requests = vi.mocked(client.resolveMapping).mock.calls.map(([request]) => request)
    expect(requests).toHaveLength(3)
    for (const request of requests) {
      expect(Object.keys(request).sort()).toEqual([
        "canonical_entity_id",
        "context_id",
        "target_engine_id",
        "target_system_namespace",
      ])
      expect(request.context_id).toBe(storedContext.context_id)
      expect(request.target_system_namespace).toBe("medusa")
      expect(request.target_engine_id).toBe("baobab-trade")
    }
  })

  it("selects the tenant's market participation by the Market's own country", async () => {
    const client = clientFor({ ...market, default_country: "ZA" })
    await resolveCommerceContext(client, selection, "access-token", "corr-1")
    expect(client.resolveStoredContext).toHaveBeenCalledWith("access-token", "corr-1", {
      tenantId: tenant.tenantId,
      countryCode: "ZA",
    })

    const noCountry = clientFor()
    await resolveCommerceContext(noCountry, selection, "access-token", "corr-1")
    expect(noCountry.resolveStoredContext).toHaveBeenCalledWith("access-token", "corr-1", {
      tenantId: tenant.tenantId,
    })
  })

  it("rejects a stored context of another tenant or another Market before resolving any mapping", async () => {
    const otherTenant = clientFor(market, { ...storedContext, tenant_id: "tn_thamani" })
    await expect(
      resolveCommerceContext(otherTenant, selection, "access-token", "corr-1"),
    ).rejects.toThrow("Stored context belongs to a tenant other than")
    expect(otherTenant.resolveMapping).not.toHaveBeenCalled()

    const otherMarket = clientFor(market, { ...storedContext, market_id: "thamani_ke_b2c" })
    await expect(
      resolveCommerceContext(otherMarket, selection, "access-token", "corr-1"),
    ).rejects.toThrow("not the Market of the Control Plane's resolved context")
    expect(otherMarket.resolveMapping).not.toHaveBeenCalled()
  })

  it("rejects a mapping resolved in another tenant or to a canonical entity instead of a Medusa object", async () => {
    await expect(
      resolveCommerceContext(
        clientFor(market, storedContext, { tenant_id: "tn_thamani" }),
        selection,
        "access-token",
        "corr-1",
      ),
    ).rejects.toThrow("other than the authenticated tenant")

    await expect(
      resolveCommerceContext(
        clientFor(market, storedContext, {
          external_reference_id: undefined,
          target_canonical_entity_id: "estate:other",
        }),
        selection,
        "access-token",
        "corr-1",
      ),
    ).rejects.toThrow("not a Medusa object")
  })
})
