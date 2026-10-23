import { describe, expect, it } from "vitest"
import {
  ControlPlaneResourceAssignmentResolver,
  RESOURCE_ASSIGNMENT_PATH,
  ResourceAssignmentError,
  type ResourceAssignmentRequest,
} from "../src/baobab/control-plane/estate-resource-assignment"

/**
 * ADR-SHARED-042 section 14 Decision 9: Trade's client for CP's governed
 * estate resource assignment attestation. Synthetic CP responses and a
 * synthetic server token only; not connected acceptance, not a registered
 * assignment and not an IAM-issued identity.
 */
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0)
const CORRELATION = "0b6f2c1e-6d0a-4f43-9c1a-2f1d6b1e9a40"
const SERVER_TOKEN = "synthetic.server.workload-token"
const DIGEST = "5d41402abc4b2a76b9719d911017c5925d41402abc4b2a76b9719d911017c592"

const attestation = (change: Record<string, unknown> = {}) => ({
  outcome: "ATTESTED",
  attestation_id: "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
  assignment_id: "4b3a2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d",
  assignment_revision: 2,
  scope: "WORKLOAD",
  workload_client_id: "synthetic-server-checkout",
  digital_estate_id: "estate_synthetic",
  tenant_id: "tn_synthetic01",
  trade_engine_instance_id: "ei_trade01",
  market_id: "market_synthetic",
  operation: "trade.order.commit",
  issued_at: new Date(NOW).toISOString(),
  expires_at: new Date(NOW + 60_000).toISOString(),
  evidence_reference: "changeset:synthetic-assign-0001",
  ...change,
})

const resolver = (respond: () => Response | Promise<Response>) => {
  const requests: { url: string; init: RequestInit }[] = []
  const instance = new ControlPlaneResourceAssignmentResolver({
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

const workload: ResourceAssignmentRequest = {
  subject: { scope: "WORKLOAD", workloadToken: SERVER_TOKEN },
  digitalEstateId: "estate_synthetic",
  marketId: "market_synthetic",
  operation: "trade.order.commit",
  correlationId: CORRELATION,
}

const native: ResourceAssignmentRequest = {
  ...workload,
  subject: {
    scope: "NATIVE_RESOURCE",
    nativeConfigurationReference: "trade/native-seller-configuration/synthetic-01",
    nativeConfigurationDigest: DIGEST,
  },
}

const code = async (promise: Promise<unknown>) =>
  promise.then(
    () => "RESOLVED",
    (error) => (error instanceof ResourceAssignmentError ? error.code : "THREW"),
  )

describe("ControlPlaneResourceAssignmentResolver", () => {
  it("forwards the server application's own token as WORKLOAD evidence, authenticated as Trade", async () => {
    const { instance, requests } = resolver(() => new Response(JSON.stringify(attestation())))
    const out = await instance.resolve(workload)
    expect(out).toMatchObject({
      scope: "WORKLOAD",
      workloadClientId: "synthetic-server-checkout",
      assignmentRevision: 2,
      tenantId: "tn_synthetic01",
      assignmentEffectiveUntil: null,
    })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe(`https://cp.example.test${RESOURCE_ASSIGNMENT_PATH}`)
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer trade-workload-token")
    expect(JSON.parse(requests[0].init.body as string)).toEqual({
      scope: "WORKLOAD",
      workload_evidence: SERVER_TOKEN,
      workload_evidence_type: "urn:ietf:params:oauth:token-type:access_token",
      digital_estate_id: "estate_synthetic",
      engine_instance_id: "ei_trade01",
      market_id: "market_synthetic",
      operation: "trade.order.commit",
      correlation_id: CORRELATION,
    })
    expect(requests[0].init.redirect).toBe("error")
  })

  it("names a native resource by its attested configuration and digest only", async () => {
    const { instance, requests } = resolver(
      () =>
        new Response(
          JSON.stringify(attestation({ scope: "NATIVE_RESOURCE", workload_client_id: undefined })),
        ),
    )
    expect((await instance.resolve(native)).workloadClientId).toBeNull()
    const body = JSON.parse(requests[0].init.body as string)
    expect(body.native_resource).toEqual({
      native_configuration_reference: "trade/native-seller-configuration/synthetic-01",
      native_configuration_digest: DIGEST,
    })
    expect(body.workload_evidence).toBeUndefined()
  })

  it("never sends a request CP would have to refuse", async () => {
    const { instance, requests } = resolver(() => new Response(JSON.stringify(attestation())))
    for (const bad of [
      { ...workload, subject: { scope: "WORKLOAD", workloadToken: "pk_short" } },
      { ...workload, subject: { scope: "PUBLISHABLE_KEY" } },
      {
        ...native,
        subject: { ...native.subject, nativeConfigurationDigest: "not-a-digest" },
      },
      { ...workload, operation: "trade.cart.modify" },
      { ...workload, marketId: "UG" },
      { ...workload, digitalEstateId: "Estate-1" },
      { ...workload, correlationId: "not-a-uuid" },
    ] as ResourceAssignmentRequest[]) {
      expect(await code(instance.resolve(bad))).toBe("RESOLUTION_UNAVAILABLE")
    }
    expect(requests).toHaveLength(0)
  })

  it("passes on CP's closed denials and treats anything else as UNAVAILABLE", async () => {
    for (const denial of [
      "CALLER_NOT_PERMITTED",
      "WORKLOAD_EVIDENCE_INVALID",
      "NATIVE_RESOURCE_NOT_ATTESTED",
      "ASSIGNMENT_NOT_FOUND",
      "ASSIGNMENT_NOT_ACTIVE",
      "OPERATION_NOT_PERMITTED",
      "MARKET_NOT_PERMITTED",
      "ENGINE_INSTANCE_NOT_PERMITTED",
      "ASSIGNMENT_AMBIGUOUS",
    ]) {
      const { instance } = resolver(
        () => new Response(JSON.stringify({ code: denial }), { status: 403 }),
      )
      expect(await code(instance.resolve(workload))).toBe(denial)
    }
    for (const respond of [
      () => new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
      () => new Response("<html>", { status: 502 }),
      () => Promise.reject(new Error("network")),
    ]) {
      const { instance } = resolver(respond)
      expect(await code(instance.resolve(workload))).toBe("RESOLUTION_UNAVAILABLE")
    }
  })

  it("never trusts a 200 that is not a current answer to exactly this question", async () => {
    for (const change of [
      { scope: "NATIVE_RESOURCE", workload_client_id: undefined },
      { workload_client_id: undefined },
      { tenant_id: undefined },
      { digital_estate_id: "estate_other" },
      { trade_engine_instance_id: "ei_other01" },
      { market_id: "market_other" },
      { operation: "trade.draft-order.finalize" },
      { expires_at: new Date(NOW).toISOString() },
      { expires_at: new Date(NOW + 61_000).toISOString() },
      {
        issued_at: new Date(NOW + 10_000).toISOString(),
        expires_at: new Date(NOW + 40_000).toISOString(),
      },
      { assignment_effective_until: new Date(NOW + 30_000).toISOString() },
      { outcome: "ASSIGNMENT_NOT_ACTIVE" },
      { extra: "field" },
    ]) {
      const { instance } = resolver(() => new Response(JSON.stringify(attestation(change))))
      expect(await code(instance.resolve(workload))).toBe("RESOLUTION_UNAVAILABLE")
    }
  })

  it("refuses an insecure or uncanonical configuration", () => {
    const tokenProvider = { getAccessToken: async () => "t" }
    expect(
      () =>
        new ControlPlaneResourceAssignmentResolver({
          baseUrl: "http://cp.example.test",
          engineInstanceId: "ei_trade01",
          tokenProvider,
        }),
    ).toThrow()
    expect(
      () =>
        new ControlPlaneResourceAssignmentResolver({
          baseUrl: "https://cp.example.test",
          engineInstanceId: "trade01",
          tokenProvider,
        }),
    ).toThrow()
  })
})
