import { afterEach, describe, expect, it, vi } from "vitest"
import { HttpControlPlaneClient } from "../src/baobab/control-plane/client"
import { ControlPlaneProblemError } from "../src/baobab/contracts/problem-details"

const validResponse = {
  tenant_id: "tn_01k4m7x9q2v6c8r3d5f1h0j4",
  entity_id: "ZURIBEANS",
  lifecycle_status: "active",
  product_id: "baobab-trade",
  entitled: true,
  entitlement_tier: null,
  cache_ttl_seconds: 15,
  resolved_at: "2026-09-01T10:00:00Z",
  correlation_id: "7c8f131b-d8ba-4d89-b60b-a187d3944074",
} as const

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("HttpControlPlaneClient.resolveContext", () => {
  it("POSTs the configured product_id to /v1/context/resolve, never a caller-supplied one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, validResponse))
    vi.stubGlobal("fetch", fetchMock)

    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
    })

    const context = await client.resolveContext("token-abc", "corr-1")

    expect(context.tenantId).toBe(validResponse.tenant_id)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://control-plane.local/v1/context/resolve")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ product_id: "baobab-trade" })
  })

  it("caches a successful resolution for at most cache_ttl_seconds and fails closed after expiry", async () => {
    let now = 0
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, validResponse))
    vi.stubGlobal("fetch", fetchMock)

    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
      now: () => now,
    })

    await client.resolveContext("token-abc", "corr-1")
    await client.resolveContext("token-abc", "corr-2")
    expect(fetchMock).toHaveBeenCalledTimes(1)

    now += 16_000
    await client.resolveContext("token-abc", "corr-3")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("surfaces a Control Plane problem response instead of retrying silently", async () => {
    const problem = {
      type: "https://errors.nabhold.com/tenant-suspended",
      title: "Tenant suspended",
      status: 403,
      code: "TENANT_SUSPENDED",
      correlation_id: "7c8f131b-d8ba-4d89-b60b-a187d3944074",
      retryable: false,
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, problem)))

    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
    })

    await expect(client.resolveContext("token-abc", "corr-1")).rejects.toThrow(
      ControlPlaneProblemError,
    )
  })

  it("fails closed on a non-conforming 200 body rather than trusting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { lifecycle_status: "active" })),
    )

    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
    })

    await expect(client.resolveContext("token-abc", "corr-1")).rejects.toThrow(
      "invalid context-resolution response",
    )
  })
})

describe("HttpControlPlaneClient.resolveMapping", () => {
  it("posts the canonical ID, capability and resolved context without inventing native IDs", async () => {
    const response = {
      mapping_id: "map_zuribeansmarket",
      canonical_entity_id: "zuribeans_za_b2b",
      external_reference_id: "ref_medusaregion",
      status: "ACTIVE",
      resolution_reason: "scope_matched",
      effective_timestamp: "2026-09-07T10:00:00Z",
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response))
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
    })

    const resolved = await client.resolveMapping(
      {
        canonical_entity_id: "zuribeans_za_b2b",
        target_capability: "commerce.market",
        target_system: "medusa",
        context: validResponse,
      },
      "token-abc",
      "corr-1",
    )

    expect(resolved.external_reference_id).toBe("ref_medusaregion")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://control-plane.local/v1/resolution/mappings")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body).canonical_entity_id).toBe("zuribeans_za_b2b")
  })

  it("fails closed if Control Plane returns a mapping for another canonical entity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          mapping_id: "map_wrongentity",
          canonical_entity_id: "thamani_za_b2c",
          external_reference_id: "ref_wrongentity",
          status: "ACTIVE",
          resolution_reason: "scope_matched",
          effective_timestamp: "2026-09-07T10:00:00Z",
        }),
      ),
    )
    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
    })

    await expect(
      client.resolveMapping(
        {
          canonical_entity_id: "zuribeans_za_b2b",
          target_system: "medusa",
          context: validResponse,
        },
        "token-abc",
        "corr-1",
      ),
    ).rejects.toThrow("invalid mapping-resolution response")
  })
})

describe("HttpControlPlaneClient.resolvePlatformContext", () => {
  it("POSTs tenant_id and organisation_id to /v1/platform-context/resolve", async () => {
    const response = {
      context_id: "ctx_01k4m7x9q2v6c8r3d5f1h0j4",
      tenant_id: "tn_01k4m7x9q2v6c8r3d5f1h0j4",
      resolved_at: "2026-09-01T10:00:00Z",
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response))
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
    })

    const resolved = await client.resolvePlatformContext(
      "tn_01k4m7x9q2v6c8r3d5f1h0j4",
      "canon-org-1",
      "workload-token",
      "corr-1",
    )

    expect(resolved.tenant_id).toBe("tn_01k4m7x9q2v6c8r3d5f1h0j4")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://control-plane.local/v1/platform-context/resolve")
    expect(init.method).toBe("POST")
    expect(init.headers.authorization).toBe("Bearer workload-token")
    expect(JSON.parse(init.body)).toEqual({
      tenant_id: "tn_01k4m7x9q2v6c8r3d5f1h0j4",
      organisation_id: "canon-org-1",
    })
  })

  it("never caches -- always re-resolves so a stale attestation can't be served", async () => {
    const response = {
      context_id: "ctx_01k4m7x9q2v6c8r3d5f1h0j4",
      tenant_id: "tn_01k4m7x9q2v6c8r3d5f1h0j4",
      resolved_at: "2026-09-01T10:00:00Z",
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response))
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
    })

    await client.resolvePlatformContext("tn_1", "canon-org-1", "workload-token", "corr-1")
    await client.resolvePlatformContext("tn_1", "canon-org-1", "workload-token", "corr-2")

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("fails closed on a non-conforming 200 body rather than trusting it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { context_id: "ctx_1" })))
    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
    })

    await expect(
      client.resolvePlatformContext("tn_1", "canon-org-1", "workload-token", "corr-1"),
    ).rejects.toThrow("invalid platform-context response")
  })

  it("surfaces a Control Plane problem response instead of retrying silently", async () => {
    const problem = {
      type: "https://errors.nabhold.com/organisation-not-found",
      title: "Organisation not found",
      status: 404,
      code: "ORGANISATION_NOT_FOUND",
      correlation_id: "7c8f131b-d8ba-4d89-b60b-a187d3944074",
      retryable: false,
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, problem)))
    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
    })

    await expect(
      client.resolvePlatformContext("tn_1", "canon-org-1", "workload-token", "corr-1"),
    ).rejects.toThrow(ControlPlaneProblemError)
  })
})
