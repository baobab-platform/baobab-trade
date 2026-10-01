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

const CONTEXT_ID = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b"

const mappingResponse = {
  context_id: CONTEXT_ID,
  tenant_id: "tn_zuribeans",
  mapping_id: "map_zuribeansmarket",
  canonical_entity_id: "zuribeans_za_b2b",
  external_reference_id: "ref_medusaregion",
  status: "ACTIVE",
  resolution_reason: "scope_matched",
  effective_timestamp: "2026-09-07T10:00:00Z",
  mapping_version: 2,
  resolved_at: "2026-09-07T10:00:01Z",
}

const mappingClient = () =>
  new HttpControlPlaneClient({
    baseUrl: "http://control-plane.local",
    contextPath: "/v1/context/resolve",
    productId: "baobab-trade",
  })

describe("HttpControlPlaneClient.resolveMapping", () => {
  it("redeems a stored context_id and supplies no tenant, market or inline context (ADR-SHARED-014)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, mappingResponse))
    vi.stubGlobal("fetch", fetchMock)

    const resolved = await mappingClient().resolveMapping(
      {
        context_id: CONTEXT_ID,
        canonical_entity_id: "zuribeans_za_b2b",
        target_system_namespace: "medusa",
        target_engine_id: "baobab-trade",
      },
      "token-abc",
      "corr-1",
    )

    expect(resolved.external_reference_id).toBe("ref_medusaregion")
    expect(resolved.context_id).toBe(CONTEXT_ID)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://control-plane.local/v1/resolution/mappings")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      context_id: CONTEXT_ID,
      canonical_entity_id: "zuribeans_za_b2b",
      target_system_namespace: "medusa",
      target_engine_id: "baobab-trade",
    })
  })

  it("fails closed if Control Plane returns a mapping for another canonical entity or another context", async () => {
    for (const wrong of [
      { canonical_entity_id: "thamani_za_b2c" },
      { context_id: "0199a1b2-c3d4-7e8f-9a0b-aaaaaaaaaaaa" },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(200, { ...mappingResponse, ...wrong })),
      )
      await expect(
        mappingClient().resolveMapping(
          { context_id: CONTEXT_ID, canonical_entity_id: "zuribeans_za_b2b" },
          "token-abc",
          "corr-1",
        ),
      ).rejects.toThrow("invalid mapping-resolution response")
    }
  })

  it("rejects a response missing the fields ADR-SHARED-014 made required", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...mappingResponse, tenant_id: undefined })),
    )
    await expect(
      mappingClient().resolveMapping(
        { context_id: CONTEXT_ID, canonical_entity_id: "zuribeans_za_b2b" },
        "token-abc",
        "corr-1",
      ),
    ).rejects.toThrow("invalid mapping-resolution response")
  })

  it("refuses to send a request without a context_id or with malformed targets", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const client = mappingClient()
    const base = { context_id: CONTEXT_ID, canonical_entity_id: "zuribeans_za_b2b" }

    await expect(
      client.resolveMapping({ ...base, context_id: "" }, "token-abc", "corr-1"),
    ).rejects.toThrow("context_id is required")
    await expect(
      client.resolveMapping({ ...base, canonical_entity_id: "no good" }, "token-abc", "corr-1"),
    ).rejects.toThrow("canonical entity ID")
    await expect(
      client.resolveMapping({ ...base, target_system_namespace: "Medusa" }, "token-abc", "corr-1"),
    ).rejects.toThrow("target_system_namespace")
    await expect(
      client.resolveMapping({ ...base, target_engine_id: "baobab_trade" }, "token-abc", "corr-1"),
    ).rejects.toThrow("target_engine_id")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("surfaces the Control Plane's problem for an unknown or other-tenant context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(404, {
          type: "https://contracts.baobab-platform.com/errors/context-not-found",
          title: "Context not found",
          status: 404,
          code: "CONTEXT_NOT_FOUND",
          correlation_id: "7c8f131b-d8ba-4d89-b60b-a187d3944074",
          retryable: false,
        }),
      ),
    )
    await expect(
      mappingClient().resolveMapping(
        { context_id: CONTEXT_ID, canonical_entity_id: "zuribeans_za_b2b" },
        "token-abc",
        "corr-1",
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_NOT_FOUND", status: 404 })
  })
})

describe("HttpControlPlaneClient.resolveStoredContext", () => {
  const stored = {
    context_id: CONTEXT_ID,
    tenant_id: "tn_zuribeans",
    resolved_at: "2026-09-07T10:00:00Z",
    market_id: "zuribeans_za_b2b",
    country_code: "ZA",
  }

  it("POSTs only the tenant and country to /v1/platform-context/resolve and returns the context_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, stored))
    vi.stubGlobal("fetch", fetchMock)

    const resolved = await mappingClient().resolveStoredContext("token-abc", "corr-1", {
      tenantId: "tn_zuribeans",
      countryCode: "ZA",
    })

    expect(resolved.context_id).toBe(CONTEXT_ID)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://control-plane.local/v1/platform-context/resolve")
    expect(JSON.parse(init.body)).toEqual({ tenant_id: "tn_zuribeans", country_code: "ZA" })
  })

  it("sends an empty body when the workload token already carries its tenant", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, stored))
    vi.stubGlobal("fetch", fetchMock)
    await mappingClient().resolveStoredContext("token-abc", "corr-1")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({})
  })

  it("rejects a non-UUID context_id, a bad country code and a missing token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...stored, context_id: "ctx_not_a_uuid" })),
    )
    await expect(mappingClient().resolveStoredContext("token-abc", "corr-1")).rejects.toThrow(
      "invalid platform-context response",
    )
    await expect(
      mappingClient().resolveStoredContext("token-abc", "corr-1", { countryCode: "za" }),
    ).rejects.toThrow("ISO 3166-1 alpha-2")
    await expect(mappingClient().resolveStoredContext("  ", "corr-1")).rejects.toThrow(
      "access token is required",
    )
  })
})

describe("HttpControlPlaneClient.resolvePlatformContext", () => {
  it("POSTs tenant_id and organisation_id to /v1/platform-context/resolve", async () => {
    const response = {
      context_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b",
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
      context_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b",
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
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { context_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b" }),
        ),
    )
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
