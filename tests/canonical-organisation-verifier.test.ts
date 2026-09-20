import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ControlPlaneCanonicalOrganisationVerifier,
} from "../src/baobab/b2b/canonical-organisation-verifier"
import { HttpControlPlaneClient } from "../src/baobab/control-plane/client"

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ZB-04 Control Plane canonical organisation verifier", () => {
  it("requests and accepts an exact BUYER_ORGANISATION attestation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        context_id: "ctx_1",
        tenant_id: "tn_zuribeans",
        organisation_id: "canorg_1",
        organisation_type: "BUYER_ORGANISATION",
        resolved_at: "2026-09-20T10:00:00Z",
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
    })
    const verifier = new ControlPlaneCanonicalOrganisationVerifier(
      { getAccessToken: vi.fn(async () => "workload-token") },
      client,
    )

    const result = await verifier.verify({
      tenantId: "tn_zuribeans",
      canonicalOrganisationId: "canorg_1",
      expectedKind: "BUYER_ORGANISATION",
    })

    expect(result.verified).toBe(true)
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      tenant_id: "tn_zuribeans",
      organisation_id: "canorg_1",
      expected_organisation_type: "BUYER_ORGANISATION",
    })
    expect(init.headers.authorization).toBe("Bearer workload-token")
  })

  it("fails verification if the attestation does not echo the exact kind", async () => {
    const client = {
      resolvePlatformContext: vi.fn(async () => ({
        context_id: "ctx_1",
        tenant_id: "tn_zuribeans",
        organisation_id: "canorg_1",
        organisation_type: "SUPPLIER_ORGANISATION",
        resolved_at: "2026-09-20T10:00:00Z",
      })),
      resolveContext: vi.fn(),
      getMarket: vi.fn(),
      resolveMapping: vi.fn(),
    }
    const verifier = new ControlPlaneCanonicalOrganisationVerifier(
      { getAccessToken: vi.fn(async () => "workload-token") },
      client as never,
    )

    const result = await verifier.verify({
      tenantId: "tn_zuribeans",
      canonicalOrganisationId: "canorg_1",
      expectedKind: "BUYER_ORGANISATION",
    })

    expect(result.verified).toBe(false)
  })

  it("fails closed on a malformed successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          context_id: "ctx_1",
          tenant_id: "tn_zuribeans",
          organisation_type: "BUYER_ORGANISATION",
        }),
      ),
    )
    const client = new HttpControlPlaneClient({
      baseUrl: "http://control-plane.local",
      contextPath: "/v1/context/resolve",
      productId: "baobab-trade",
    })
    const verifier = new ControlPlaneCanonicalOrganisationVerifier(
      { getAccessToken: vi.fn(async () => "workload-token") },
      client,
    )

    await expect(
      verifier.verify({
        tenantId: "tn_zuribeans",
        canonicalOrganisationId: "canorg_1",
        expectedKind: "BUYER_ORGANISATION",
      }),
    ).rejects.toThrow("invalid platform-context response")
  })
})
