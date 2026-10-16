import { afterEach, describe, expect, it, vi } from "vitest"
import {
  HttpSellerBindingAttestationClient,
  SELLER_BINDING_ATTESTATION_PATH,
  type NativeConfigurationAttestationRequest,
} from "../src/baobab/control-plane/seller-binding-attestation"
import {
  attestNativeSellerConfiguration,
  PostgresNativeConfigurationAttestationStore,
  type NativeConfigurationAttestationDependencies,
  type RecordedNativeConfigurationAttestation,
} from "../src/baobab/orders/native-configuration-attestation"
import { canonicalNativeSellerConfiguration } from "../src/baobab/orders/native-seller-configuration"

const org = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c"
const contextId = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a01"
const expected = { tenantId: "tn_zuribeans", organisationId: org, market: "UG" }
const request: NativeConfigurationAttestationRequest = {
  context_id: contextId,
  engine_instance_id: "ei_tradestaging01",
  native_configuration_reference: "trade/native-seller-configuration/zuribeans-ug",
  native_configuration_digest: "ab".repeat(32),
  currency_scope: ["UGX"],
  attested_at: "2026-10-16T10:00:00.000Z",
}
const accepted = (over: Record<string, unknown> = {}) => ({
  attestation_id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
  tenant_id: "tn_zuribeans",
  operating_organisation_id: org,
  market: "UG",
  engine_instance_id: request.engine_instance_id,
  native_configuration_reference: request.native_configuration_reference,
  native_configuration_digest: request.native_configuration_digest,
  currency_scope: ["UGX"],
  attested_at: "2026-10-16T10:00:00Z",
  recorded_at: "2026-10-16T10:00:00.120Z",
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe("ADR-SHARED-039 CP native-configuration attestation client", () => {
  it("posts the pinned request to the private CP route and accepts an exact echo", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(accepted()), { status: 201 }))
    vi.stubGlobal("fetch", fetch)
    const result = await new HttpSellerBindingAttestationClient("https://cp.example.test/").attest(
      request,
      expected,
      "workload-token",
      "corr-1",
    )
    expect(result.attestation_id).toBe("5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d")
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`https://cp.example.test${SELLER_BINDING_ATTESTATION_PATH}`)
    expect(init.redirect).toBe("error")
    expect(init.headers).toMatchObject({
      authorization: "Bearer workload-token",
      "cache-control": "no-store",
    })
    expect(JSON.parse(init.body)).toEqual(request)
  })

  it.each([
    ["another tenant", { tenant_id: "tn_other" }],
    ["another Organisation", { operating_organisation_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6d" }],
    ["another market", { market: "KE" }],
    ["another engine", { engine_instance_id: "ei_tradeother01" }],
    ["another reference", { native_configuration_reference: "trade/other" }],
    ["another digest", { native_configuration_digest: "cd".repeat(32) }],
    ["another currency scope", { currency_scope: ["UGX", "USD"] }],
    ["another attestation time", { attested_at: "2026-10-16T10:00:01Z" }],
    ["an unknown field", { binding_status: "ACTIVE" }],
    ["no attestation id", { attestation_id: undefined }],
  ])("fails closed on an echo with %s", async (_name, over) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(accepted(over)), { status: 201 })),
    )
    await expect(
      new HttpSellerBindingAttestationClient("https://cp.example.test").attest(
        request,
        expected,
        "t",
        "c",
      ),
    ).rejects.toThrow(/fail closed/)
  })

  it("treats any non-201 answer as refusal", async () => {
    for (const status of [200, 403, 404, 422, 503]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(accepted()), { status })),
      )
      await expect(
        new HttpSellerBindingAttestationClient("https://cp.example.test").attest(
          request,
          expected,
          "t",
          "c",
        ),
      ).rejects.toThrow(/unavailable or refused/)
    }
  })

  it("never sends an invalid request, a blank token or to a plain-HTTP CP", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const client = new HttpSellerBindingAttestationClient("https://cp.example.test")
    for (const bad of [
      { ...request, native_configuration_digest: "ABC" },
      { ...request, tenant_id: "tn_forged" },
      { ...request, currency_scope: [] },
    ]) {
      await expect(
        client.attest(bad as NativeConfigurationAttestationRequest, expected, "t", "c"),
      ).rejects.toThrow(/Invalid native-configuration attestation request/)
    }
    await expect(client.attest(request, expected, " ", "c")).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(() => new HttpSellerBindingAttestationClient("http://cp.example.test")).toThrow(/HTTPS/)
  })
})

const scope = {
  reference: "trade/native-seller-configuration/zuribeans-ug",
  tenantId: "tn_zuribeans",
  organisationId: org,
  market: "UG",
  engineInstanceId: "ei_tradestaging01",
  currencyScope: ["UGX"],
  salesChannelIds: ["sc_a"],
  regionIds: ["reg_ugx"],
}
const facts = {
  read: vi.fn(async () => ({
    salesChannels: [{ id: "sc_a", is_disabled: false }],
    regions: [{ id: "reg_ugx", currency_code: "ugx", countries: ["ug"] }],
  })),
}

const deps = (over: Partial<NativeConfigurationAttestationDependencies> = {}) => {
  const recorded: RecordedNativeConfigurationAttestation[] = []
  const sent: NativeConfigurationAttestationRequest[] = []
  const d: NativeConfigurationAttestationDependencies = {
    facts,
    tokens: { getAccessToken: vi.fn(async () => "workload-token") },
    controlPlane: {
      resolvePlatformContext: vi.fn(async (tenantId: string, organisationId: string) => ({
        context_id: contextId,
        tenant_id: tenantId,
        organisation_id: organisationId,
        organisation_type: "ORGANISATION",
        country_code: "UG",
        resolved_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })),
    },
    attestations: {
      attest: vi.fn(async (req: NativeConfigurationAttestationRequest) => {
        sent.push(req)
        return accepted({
          native_configuration_digest: req.native_configuration_digest,
          attested_at: req.attested_at,
        }) as ReturnType<typeof accepted> & { currency_scope: string[] }
      }),
    } as NativeConfigurationAttestationDependencies["attestations"],
    store: {
      record: vi.fn(async (a: RecordedNativeConfigurationAttestation) => void recorded.push(a)),
    },
    environment: { node: "test", enabled: "true" },
    ...over,
  }
  return { d, recorded, sent }
}

describe("ADR-SHARED-039 attestation composition", () => {
  it("attests the LIVE digest under a context for the declared seller and records it", async () => {
    const { d, recorded, sent } = deps()
    const result = await attestNativeSellerConfiguration(scope, d)
    const live = canonicalNativeSellerConfiguration(
      scope,
      [{ id: "sc_a", is_disabled: false }],
      [{ id: "reg_ugx", currency_code: "ugx", countries: ["ug"] }],
    )
    expect(sent[0].native_configuration_digest).toBe(live.digest)
    expect(sent[0].context_id).toBe(contextId)
    expect(d.controlPlane.resolvePlatformContext).toHaveBeenCalledWith(
      "tn_zuribeans",
      org,
      "workload-token",
      expect.stringMatching(/^trade-attestation\//),
      undefined,
      "UG",
    )
    expect(recorded).toHaveLength(1)
    expect(result.canonical_configuration).toBe(live.canonical)
  })

  it.each([
    ["production", { node: "production", enabled: "true" }],
    ["no profile", { enabled: "true" }],
    ["unknown profile", { baobab: "preview", enabled: "true" }],
    ["not enabled", { node: "test" }],
  ])("refuses to run with %s before any read or network call", async (_name, environment) => {
    const { d, sent } = deps({ environment })
    facts.read.mockClear()
    await expect(attestNativeSellerConfiguration(scope, d)).rejects.toThrow(
      /explicit non-production/,
    )
    expect(facts.read).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it.each([
    ["another Organisation", { organisation_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6d" }],
    ["another market", { country_code: "KE" }],
    ["another tenant", { tenant_id: "tn_other" }],
    ["an expired context", { expires_at: new Date(Date.now() - 1000).toISOString() }],
    ["no expiry", { expires_at: undefined }],
  ])("refuses a CP context for %s", async (_name, over) => {
    const { d, sent, recorded } = deps()
    d.controlPlane.resolvePlatformContext = vi.fn(async () => ({
      context_id: contextId,
      tenant_id: "tn_zuribeans",
      organisation_id: org,
      organisation_type: "ORGANISATION",
      country_code: "UG",
      resolved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      ...over,
    }))
    await expect(attestNativeSellerConfiguration(scope, d)).rejects.toThrow(/does not match/)
    expect(sent).toHaveLength(0)
    expect(recorded).toHaveLength(0)
  })

  it("records nothing when CP refuses or the store fails", async () => {
    const refused = deps()
    refused.d.attestations.attest = vi.fn(async () => {
      throw new Error("Control Plane native-configuration attestation unavailable or refused")
    })
    await expect(attestNativeSellerConfiguration(scope, refused.d)).rejects.toThrow(/refused/)
    expect(refused.recorded).toHaveLength(0)
    const failing = deps({
      store: { record: vi.fn(async () => Promise.reject(new Error("db down"))) },
    })
    await expect(attestNativeSellerConfiguration(scope, failing.d)).rejects.toThrow(/db down/)
  })
})

describe("PostgresNativeConfigurationAttestationStore", () => {
  it("inserts exactly one append-only row and releases the client", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }))
    const release = vi.fn()
    const store = new PostgresNativeConfigurationAttestationStore({
      connect: async () => ({ query, release }),
    })
    await store.record({
      ...(accepted() as RecordedNativeConfigurationAttestation),
      canonical_configuration: "{}",
      context_id: contextId,
      correlation_id: "corr",
    })
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toMatch(/^INSERT INTO trade_native_configuration_attestation/)
    expect(sql).not.toMatch(/ON CONFLICT|UPDATE/)
    expect(values[8]).toEqual(["UGX"])
    expect(release).toHaveBeenCalledOnce()
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    await expect(
      store.record({
        ...(accepted() as RecordedNativeConfigurationAttestation),
        canonical_configuration: "{}",
        context_id: contextId,
        correlation_id: "corr",
      }),
    ).rejects.toThrow(/not recorded/)
    expect(release).toHaveBeenCalledTimes(2)
  })
})
