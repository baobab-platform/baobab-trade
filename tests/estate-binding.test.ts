import { describe, expect, it } from "vitest"
import {
  ControlPlaneEstateBindingResolver,
  ESTATE_BINDING_PATH,
  EstateBindingError,
} from "../src/baobab/control-plane/estate-binding"

/**
 * ADR-SHARED-042 CAA-04: Trade's client for CP's estate client binding
 * attestation. Synthetic CP responses only; not connected acceptance.
 */
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const CORRELATION = "0b6f2c1e-6d0a-4f43-9c1a-2f1d6b1e9a40"
const EVIDENCE = "synthetic-header.synthetic-payload.synthetic-signature"

const attestation = (change: Record<string, unknown> = {}) => ({
  outcome: "ATTESTED",
  binding_id: "5d2c7f0e-3b1a-4c6d-9e8f-0a1b2c3d4e5f",
  revision: 3,
  issuer: "https://iam.example.test",
  bff_client_id: "zuribeans-bff",
  digital_estate_id: "zuribeans",
  tenant_id: "tn_zuribeans",
  engine_instance_id: "ei_trade01",
  environment: "staging",
  deployment_reference: "deployment.zuribeans.staging",
  attested_at: new Date(NOW).toISOString(),
  expires_at: new Date(NOW + 60_000).toISOString(),
  evidence_reference: "changeset:synthetic-0001",
  ...change,
})

const resolver = (respond: () => Response | Promise<Response>) => {
  const requests: { url: string; init: RequestInit }[] = []
  const instance = new ControlPlaneEstateBindingResolver({
    baseUrl: "https://cp.example.test",
    engineInstanceId: "ei_trade01",
    environment: "staging",
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
  clientEvidence: EVIDENCE,
  subjectAuthorisedParty: "zuribeans-bff",
  correlationId: CORRELATION,
}

describe("ControlPlaneEstateBindingResolver", () => {
  it("presents the BFF evidence with Trade's own workload credential and states only itself", async () => {
    const { instance, requests } = resolver(() => new Response(JSON.stringify(attestation())))
    const out = await instance.resolve(request)
    expect(out).toMatchObject({
      digitalEstateId: "zuribeans",
      tenantId: "tn_zuribeans",
      revision: 3,
    })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe(`https://cp.example.test${ESTATE_BINDING_PATH}`)
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer trade-workload-token")
    const body = JSON.parse(requests[0].init.body as string)
    expect(body).toEqual({
      purpose: "BUYER_OPERATION",
      client_evidence: EVIDENCE,
      client_evidence_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_authorised_party: "zuribeans-bff",
      engine_instance_id: "ei_trade01",
      environment: "staging",
      correlation_id: CORRELATION,
    })
  })

  it("maps CP denials closed and an unmounted route to unavailable", async () => {
    for (const [status, code, expected] of [
      [404, "BINDING_NOT_FOUND", "BINDING_NOT_FOUND"],
      [409, "BINDING_AMBIGUOUS", "BINDING_AMBIGUOUS"],
      [403, "ENVIRONMENT_MISMATCH", "ENVIRONMENT_MISMATCH"],
      [403, "BINDING_NOT_ACTIVE", "BINDING_NOT_ACTIVE"],
      [404, "NOT_FOUND", "RESOLUTION_UNAVAILABLE"],
      [500, "INTERNAL", "RESOLUTION_UNAVAILABLE"],
    ] as const) {
      const { instance } = resolver(() => new Response(JSON.stringify({ code }), { status }))
      const error = await instance.resolve(request).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(EstateBindingError)
      expect((error as EstateBindingError).code).toBe(expected)
    }
  })

  it("never trusts a bare 200", async () => {
    for (const change of [
      { engine_instance_id: "ei_other01" },
      { environment: "development" },
      { bff_client_id: "other-bff" },
      { expires_at: new Date(NOW - 1).toISOString() },
      { expires_at: new Date(NOW + 61_000).toISOString() },
      { outcome: "RESOLVED" },
      { tenant_id: "tenant-1" },
    ]) {
      const { instance } = resolver(() => new Response(JSON.stringify(attestation(change))))
      await expect(instance.resolve(request)).rejects.toMatchObject({
        code: "RESOLUTION_UNAVAILABLE",
      })
    }
    const { instance } = resolver(() => new Response(JSON.stringify(attestation())))
    await expect(
      instance.resolve({ ...request, requestedDigitalEstateId: "other_estate" }),
    ).rejects.toMatchObject({ code: "RESOLUTION_UNAVAILABLE" })
  })

  it("is unavailable on transport failure and refuses unsafe configuration", async () => {
    const { instance } = resolver(() => {
      throw new Error("down")
    })
    await expect(instance.resolve(request)).rejects.toMatchObject({
      code: "RESOLUTION_UNAVAILABLE",
    })
    const base = {
      baseUrl: "https://cp.example.test",
      engineInstanceId: "ei_trade01",
      environment: "staging",
      tokenProvider: { getAccessToken: async () => "t" },
    }
    expect(
      () => new ControlPlaneEstateBindingResolver({ ...base, baseUrl: "http://cp.example.test" }),
    ).toThrow()
    expect(
      () => new ControlPlaneEstateBindingResolver({ ...base, engineInstanceId: "trade-1" }),
    ).toThrow()
    expect(
      () => new ControlPlaneEstateBindingResolver({ ...base, environment: "production" }),
    ).toThrow()
  })
})
