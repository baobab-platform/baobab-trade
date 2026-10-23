import { describe, expect, it } from "vitest"
import {
  COMMERCE_PROFILE_PATH,
  CommerceProfileError,
  ControlPlaneCommerceProfileResolver,
} from "../src/baobab/control-plane/estate-commerce-profile"

/**
 * ADR-SHARED-042 section 14 Decision 8: Trade's client for CP's estate
 * commerce profile attestation. Synthetic CP responses only; not connected
 * acceptance and not a registered profile.
 */
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const CORRELATION = "0b6f2c1e-6d0a-4f43-9c1a-2f1d6b1e9a40"
const BINDING = "5d2c7f0e-3b1a-4c6d-9e8f-0a1b2c3d4e5f"

const attestation = (change: Record<string, unknown> = {}) => ({
  outcome: "ATTESTED",
  attestation_id: "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
  commerce_profile_id: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
  profile_revision: 2,
  digital_estate_id: "estate_synthetic",
  tenant_id: "tn_synthetic01",
  trade_engine_instance_id: "ei_trade01",
  market_id: "market_synthetic",
  commerce_model: "B2B",
  issued_at: new Date(NOW).toISOString(),
  expires_at: new Date(NOW + 60_000).toISOString(),
  evidence_reference: "changeset:synthetic-0002",
  ...change,
})

const resolver = (respond: () => Response | Promise<Response>) => {
  const requests: { url: string; init: RequestInit }[] = []
  const instance = new ControlPlaneCommerceProfileResolver({
    baseUrl: "https://cp.example.test",
    engineInstanceId: "ei_trade01",
    tokenProvider: { getAccessToken: async () => "trade-workload-token" },
    now: () => NOW,
    fetcher: (async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: url.toString(), init: init ?? {} })
      return respond()
    }) as typeof fetch,
  })
  return { instance, requests }
}

const request = {
  digitalEstateId: "estate_synthetic",
  marketId: "market_synthetic",
  provenance: { kind: "ESTATE_CLIENT_BINDING" as const, reference: BINDING },
  correlationId: CORRELATION,
}

const code = async (promise: Promise<unknown>) =>
  promise.then(
    () => "RESOLVED",
    (error) => (error instanceof CommerceProfileError ? error.code : "THREW"),
  )

describe("ControlPlaneCommerceProfileResolver", () => {
  it("states the estate, its own instance, the Market and its binding provenance, nothing else", async () => {
    const { instance, requests } = resolver(() => new Response(JSON.stringify(attestation())))
    const out = await instance.resolve(request)
    expect(out).toMatchObject({
      commerceModel: "B2B",
      profileRevision: 2,
      tenantId: "tn_synthetic01",
      marketId: "market_synthetic",
      profileEffectiveUntil: null,
    })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe(`https://cp.example.test${COMMERCE_PROFILE_PATH}`)
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer trade-workload-token")
    expect(headers["x-correlation-id"]).toBe(CORRELATION)
    expect(JSON.parse(requests[0].init.body as string)).toEqual({
      digital_estate_id: "estate_synthetic",
      engine_instance_id: "ei_trade01",
      market_id: "market_synthetic",
      estate_provenance: { kind: "ESTATE_CLIENT_BINDING", reference: BINDING },
      correlation_id: CORRELATION,
    })
    expect(requests[0].init.redirect).toBe("error")
  })

  it("names a governed resource assignment attestation as its Decision 9 provenance", async () => {
    const { instance, requests } = resolver(() => new Response(JSON.stringify(attestation())))
    await instance.resolve({
      ...request,
      provenance: { kind: "GOVERNED_RESOURCE_ASSIGNMENT", reference: BINDING },
    })
    expect(JSON.parse(requests[0].init.body as string).estate_provenance).toEqual({
      kind: "GOVERNED_RESOURCE_ASSIGNMENT",
      reference: BINDING,
    })
  })

  it("never sends a request CP would have to refuse", async () => {
    const { instance, requests } = resolver(() => new Response(JSON.stringify(attestation())))
    for (const bad of [
      {
        ...request,
        provenance: { kind: "ESTATE_CLIENT_BINDING" as const, reference: "zuribeans" },
      },
      { ...request, provenance: { kind: "SALES_CHANNEL", reference: BINDING } as never },
      { ...request, marketId: "UG" },
      { ...request, digitalEstateId: "Estate-1" },
      { ...request, correlationId: "not-a-uuid" },
    ]) {
      expect(await code(instance.resolve(bad))).toBe("RESOLUTION_UNAVAILABLE")
    }
    expect(requests).toHaveLength(0)
  })

  it("passes on CP's closed denials and treats anything else as UNAVAILABLE", async () => {
    for (const denial of [
      "PROFILE_NOT_REGISTERED",
      "PROFILE_NOT_ACTIVE",
      "PROFILE_AMBIGUOUS",
      "ESTATE_PROVENANCE_INVALID",
      "ENGINE_INSTANCE_NOT_PERMITTED",
      "CALLER_NOT_PERMITTED",
    ]) {
      const { instance } = resolver(
        () => new Response(JSON.stringify({ code: denial }), { status: 403 }),
      )
      expect(await code(instance.resolve(request))).toBe(denial)
    }
    for (const respond of [
      () => new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
      () => new Response("<html>", { status: 502 }),
      () => Promise.reject(new Error("network")),
    ]) {
      const { instance } = resolver(respond)
      expect(await code(instance.resolve(request))).toBe("RESOLUTION_UNAVAILABLE")
    }
  })

  it("never trusts a 200 that is not a current answer to exactly this question", async () => {
    for (const change of [
      { commerce_model: "MIXED" },
      { tenant_id: undefined },
      { digital_estate_id: "estate_other" },
      { trade_engine_instance_id: "ei_other01" },
      { market_id: "market_other" },
      { expires_at: new Date(NOW).toISOString() },
      { expires_at: new Date(NOW + 61_000).toISOString() },
      {
        issued_at: new Date(NOW + 10_000).toISOString(),
        expires_at: new Date(NOW + 40_000).toISOString(),
      },
      { profile_effective_until: new Date(NOW + 30_000).toISOString() },
      { outcome: "PROFILE_NOT_ACTIVE" },
      { extra: "field" },
    ]) {
      const { instance } = resolver(() => new Response(JSON.stringify(attestation(change))))
      expect(await code(instance.resolve(request))).toBe("RESOLUTION_UNAVAILABLE")
    }
  })

  it("carries the profile's end when CP attests one", async () => {
    const until = new Date(NOW + 30_000).toISOString()
    const { instance } = resolver(
      () =>
        new Response(
          JSON.stringify(attestation({ expires_at: until, profile_effective_until: until })),
        ),
    )
    expect((await instance.resolve(request)).profileEffectiveUntil?.toISOString()).toBe(until)
  })

  it("refuses an insecure or uncanonical configuration", () => {
    const tokenProvider = { getAccessToken: async () => "t" }
    expect(
      () =>
        new ControlPlaneCommerceProfileResolver({
          baseUrl: "http://cp.example.test",
          engineInstanceId: "ei_trade01",
          tokenProvider,
        }),
    ).toThrow()
    expect(
      () =>
        new ControlPlaneCommerceProfileResolver({
          baseUrl: "https://cp.example.test",
          engineInstanceId: "trade01",
          tokenProvider,
        }),
    ).toThrow()
  })
})
