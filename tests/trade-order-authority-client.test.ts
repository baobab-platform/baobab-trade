import { afterEach, describe, expect, it, vi } from "vitest"
import {
  HttpTradeOrderAuthorityClient,
  isCurrentOrderAuthority,
  SELLER_BINDING_RESOLVE_PATH,
  TRADE_ORDER_AUTHORITY_PATH,
  type BindingResolveRequest,
  type OrderAuthorityDecision,
  type OrderAuthorityRequest,
} from "../src/baobab/control-plane/trade-order-authority"
import {
  resolveNativeConfiguration,
  type AttestedNativeConfiguration,
} from "../src/baobab/orders/native-configuration-resolver"
import { canonicalNativeSellerConfiguration } from "../src/baobab/orders/native-seller-configuration"

const CP = "https://cp.example.test"
const context = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a01"
const org = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c"
const binding = { binding_id: "3f9a1c2e-7b4d-4e8a-9c1f-2d6e5b4a3c21", binding_version: 2 }
const digest = "ab".repeat(32)

const discover: BindingResolveRequest = {
  context_id: context,
  engine_instance_id: "ei_tradestaging01",
  native_configuration_reference: "trade:seller-config/synthetic-01/v2",
  native_configuration_digest: digest,
  currency: "UGX",
}
const resolved = (over: Record<string, unknown> = {}) => ({
  resolution_id: "4a6b8c0d-2e4f-4a6b-8c0d-2e4f6a8b0c2d",
  ...discover,
  outcome: "RESOLVED",
  binding_reference: binding,
  status: "ACTIVE",
  effective_from: "2026-10-16T00:00:00Z",
  resolved_at: "2026-10-16T12:00:00Z",
  provider_permissions_granted: false,
  ...over,
})
const authorityRequest: OrderAuthorityRequest = {
  context_id: context,
  engine_instance_id: "ei_tradestaging01",
  operation_class: "trade.order.commit",
  seller_operating_binding_reference: binding,
  native_configuration_digest: digest,
  currency: "UGX",
  operation_reference: "trade/trade.order.commit/cart_01/r1/a1",
}
const evaluated = Date.parse("2026-10-16T12:00:00Z")
const authorized = (over: Record<string, unknown> = {}): OrderAuthorityDecision =>
  ({
    decision_id: "b4e9c7d1-5b2f-4e6a-8c1d-9f0b7e3a2c55",
    ...authorityRequest,
    outcome: "AUTHORIZED",
    tenant_id: "tn_synthetic01",
    operating_organisation_id: org,
    market: "UG",
    legal_actor_role: "SELLER_OF_RECORD",
    activity: "CHECKOUT_ORDER_COMMITMENT",
    mandate_id: "7d2b9e4f-6a1c-4f3e-b8d5-0c9a8e7f6d21",
    responsible_legal_entity_id: "SYNTHETIC-LE-01",
    evidence_references: ["synthetic:mandate-evidence/01"],
    mandate_effective_from: "2026-10-15T12:00:00Z",
    evaluated_at: new Date(evaluated).toISOString(),
    expires_at: new Date(evaluated + 30_000).toISOString(),
    policy_reference: "ADR-SHARED-039/trade-order-authority:v1",
    provider_permissions_granted: false,
    ...over,
  }) as OrderAuthorityDecision

const reply = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))

afterEach(() => vi.unstubAllGlobals())

describe("TA-03 binding discovery client", () => {
  it("posts the pinned request and accepts an exactly correlated RESOLVED answer", async () => {
    const fetch = reply(resolved())
    vi.stubGlobal("fetch", fetch)
    const r = await new HttpTradeOrderAuthorityClient(CP).resolveBinding(discover, "t", "c")
    expect(r.binding_reference).toEqual(binding)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(CP + SELLER_BINDING_RESOLVE_PATH)
    expect(init.redirect).toBe("error")
    expect(init.headers).toMatchObject({ authorization: "Bearer t", "cache-control": "no-store" })
    expect(JSON.parse(init.body)).toEqual(discover)
  })

  it("returns denials unchanged, without a binding", async () => {
    const denied = { ...resolved({ outcome: "AMBIGUOUS_BINDING" }) } as Record<string, unknown>
    delete denied.binding_reference
    delete denied.status
    delete denied.effective_from
    vi.stubGlobal("fetch", reply(denied))
    const r = await new HttpTradeOrderAuthorityClient(CP).resolveBinding(discover, "t", "c")
    expect(r.outcome).toBe("AMBIGUOUS_BINDING")
    expect(r.binding_reference).toBeUndefined()
  })

  it.each([
    ["context", { context_id: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e" }],
    ["engine", { engine_instance_id: "ei_tradestaging02" }],
    ["reference", { native_configuration_reference: "trade:seller-config/other/v1" }],
    ["digest", { native_configuration_digest: "cd".repeat(32) }],
    ["currency", { currency: "USD" }],
    ["inactive status", { status: "SUSPENDED" }],
    ["granted permissions", { provider_permissions_granted: true }],
    ["unknown field", { decision_id: "b4e9c7d1-5b2f-4e6a-8c1d-9f0b7e3a2c55" }],
  ])("fails closed on an answer with another %s", async (_n, over) => {
    vi.stubGlobal("fetch", reply(resolved(over)))
    await expect(
      new HttpTradeOrderAuthorityClient(CP).resolveBinding(discover, "t", "c"),
    ).rejects.toThrow(/fail closed/)
  })

  it("treats any non-200 as refusal and never sends an invalid request", async () => {
    for (const status of [201, 400, 403, 503]) {
      vi.stubGlobal("fetch", reply(resolved(), status))
      await expect(
        new HttpTradeOrderAuthorityClient(CP).resolveBinding(discover, "t", "c"),
      ).rejects.toThrow(/refused/)
    }
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    for (const bad of [
      { ...discover, tenant_id: "tn_forged" },
      { ...discover, currency: "ugx" },
      { ...discover, cart_id: "cart_01" },
    ]) {
      await expect(
        new HttpTradeOrderAuthorityClient(CP).resolveBinding(
          bad as BindingResolveRequest,
          "t",
          "c",
        ),
      ).rejects.toThrow(/Invalid seller binding discovery request/)
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(() => new HttpTradeOrderAuthorityClient("http://cp.example.test")).toThrow(/HTTPS/)
  })
})

describe("TA-03 order-authority client and lease", () => {
  it("accepts an exactly correlated decision and stamps its receipt time", async () => {
    const fetch = reply(authorized())
    vi.stubGlobal("fetch", fetch)
    const { decision, receivedAt } = await new HttpTradeOrderAuthorityClient(
      CP,
      3000,
      () => evaluated + 100,
    ).resolveOrderAuthority(authorityRequest, "t", "c")
    expect(fetch.mock.calls[0][0]).toBe(CP + TRADE_ORDER_AUTHORITY_PATH)
    expect(receivedAt).toBe(evaluated + 100)
    expect(isCurrentOrderAuthority(decision, receivedAt, evaluated + 1_000)).toBe(true)
  })

  it.each([
    [
      "operation class",
      { operation_class: "trade.order.create", activity: "DIRECT_ORDER_COMMITMENT" },
    ],
    ["binding version", { seller_operating_binding_reference: { ...binding, binding_version: 3 } }],
    ["digest", { native_configuration_digest: "cd".repeat(32) }],
    ["currency", { currency: "USD" }],
    ["operation reference", { operation_reference: "trade/trade.order.commit/cart_02/r1/a1" }],
    ["context", { context_id: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e" }],
  ])("fails closed on a decision for another %s", async (_n, over) => {
    vi.stubGlobal("fetch", reply(authorized(over)))
    await expect(
      new HttpTradeOrderAuthorityClient(CP).resolveOrderAuthority(authorityRequest, "t", "c"),
    ).rejects.toThrow(/fail closed/)
  })

  it("refuses to request a reserved class", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    await expect(
      new HttpTradeOrderAuthorityClient(CP).resolveOrderAuthority(
        {
          ...authorityRequest,
          operation_class: "trade.order.manage",
        } as unknown as OrderAuthorityRequest,
        "t",
        "c",
      ),
    ).rejects.toThrow(/Invalid Trade order-authority request/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("honours a decision only until min(expires_at, receipt + 30 s)", () => {
    const d = authorized()
    expect(isCurrentOrderAuthority(d, evaluated, evaluated + 29_999)).toBe(true)
    expect(isCurrentOrderAuthority(d, evaluated, evaluated + 30_000)).toBe(false)
    // A late receipt cannot extend CP's own expiry.
    expect(isCurrentOrderAuthority(d, evaluated + 20_000, evaluated + 31_000)).toBe(false)
    // An early CP expiry wins.
    const short = authorized({ expires_at: new Date(evaluated + 5_000).toISOString() })
    expect(isCurrentOrderAuthority(short, evaluated, evaluated + 6_000)).toBe(false)
    // Denials, missing leases, and leases over 30 s are never current.
    expect(
      isCurrentOrderAuthority(authorized({ outcome: "BINDING_NOT_ACTIVE" }), evaluated, evaluated),
    ).toBe(false)
    expect(
      isCurrentOrderAuthority(authorized({ expires_at: undefined }), evaluated, evaluated),
    ).toBe(false)
    const long = authorized({ expires_at: new Date(evaluated + 31_000).toISOString() })
    expect(isCurrentOrderAuthority(long, evaluated, evaluated + 1_000)).toBe(false)
    // A decision "evaluated" in the future relative to receipt is not trusted.
    expect(isCurrentOrderAuthority(d, evaluated - 5_000, evaluated)).toBe(false)
  })
})

const scope = {
  reference: "trade:seller-config/synthetic-01/v2",
  tenantId: "tn_synthetic01",
  organisationId: org,
  market: "UG",
  engineInstanceId: "ei_tradestaging01",
  currencyScope: ["UGX", "USD"],
  salesChannelIds: ["sc_a"],
  regionIds: ["reg_ugx", "reg_usd"],
}
const liveFacts = {
  salesChannels: [{ id: "sc_a", is_disabled: false }],
  regions: [
    { id: "reg_ugx", currency_code: "ugx", countries: ["ug"] },
    { id: "reg_usd", currency_code: "usd", countries: ["ug"] },
  ],
}
const attestedFrom = (
  s: typeof scope,
  id = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
): AttestedNativeConfiguration => ({
  attestation_id: id,
  native_configuration_reference: s.reference,
  canonical_configuration: canonicalNativeSellerConfiguration(
    s,
    liveFacts.salesChannels,
    liveFacts.regions,
  ).canonical,
})

describe("TA-03 native configuration resolver", () => {
  const facts = (f = liveFacts) => ({ read: vi.fn(async () => f) })

  it("maps a native record to exactly one attested configuration and its live digest", async () => {
    const r = await resolveNativeConfiguration(
      { salesChannelId: "sc_a", regionId: "reg_usd", currency: "usd" },
      "ei_tradestaging01",
      { latestForEngine: async () => [attestedFrom(scope)] },
      facts(),
    )
    expect(r).toMatchObject({
      reference: scope.reference,
      currency: "USD",
      tenantId: scope.tenantId,
      organisationId: org,
      market: "UG",
    })
    expect(r.digest).toBe(
      canonicalNativeSellerConfiguration(scope, liveFacts.salesChannels, liveFacts.regions).digest,
    )
  })

  it("reproduces the attested digest from unchanged records and denies, never re-digests, live drift", async () => {
    const unchanged = { ...liveFacts, regions: [...liveFacts.regions].reverse() }
    const before = canonicalNativeSellerConfiguration(
      scope,
      liveFacts.salesChannels,
      liveFacts.regions,
    ).digest
    // Drift in a digested attribute is denied before any digest reaches CP.
    await expect(
      resolveNativeConfiguration(
        { salesChannelId: "sc_a", regionId: "reg_ugx", currency: "UGX" },
        "ei_tradestaging01",
        { latestForEngine: async () => [attestedFrom(scope)] },
        facts({ ...liveFacts, salesChannels: [{ id: "sc_a", is_disabled: true }] }),
      ),
    ).rejects.toThrow(/disabled/)
    await expect(
      resolveNativeConfiguration(
        { salesChannelId: "sc_a", regionId: "reg_ugx", currency: "UGX" },
        "ei_tradestaging01",
        { latestForEngine: async () => [attestedFrom(scope)] },
        facts({
          ...liveFacts,
          regions: [
            liveFacts.regions[0],
            { id: "reg_usd", currency_code: "usd", countries: ["ke"] },
          ],
        }),
      ),
    ).rejects.toThrow(/outside the market/)
    const same = await resolveNativeConfiguration(
      { salesChannelId: "sc_a", regionId: "reg_ugx", currency: "UGX" },
      "ei_tradestaging01",
      { latestForEngine: async () => [attestedFrom(scope)] },
      facts(unchanged),
    )
    expect(same.digest).toBe(before)
  })

  it.each([
    [
      "an uncovered channel",
      { salesChannelId: "sc_z", regionId: "reg_ugx", currency: "UGX" },
      /no attested/,
    ],
    [
      "an uncovered region",
      { salesChannelId: "sc_a", regionId: "reg_kes", currency: "UGX" },
      /no attested/,
    ],
    [
      "a currency the region does not serve",
      { salesChannelId: "sc_a", regionId: "reg_ugx", currency: "USD" },
      /no attested/,
    ],
    [
      "a missing currency",
      { salesChannelId: "sc_a", regionId: "reg_ugx", currency: "" },
      /currency required/,
    ],
  ])("denies %s", async (_n, native, error) => {
    await expect(
      resolveNativeConfiguration(
        native,
        "ei_tradestaging01",
        { latestForEngine: async () => [attestedFrom(scope)] },
        facts(),
      ),
    ).rejects.toThrow(error)
  })

  it("denies several covering configurations and documents for another engine", async () => {
    const other = { ...scope, reference: "trade:seller-config/synthetic-02/v1" }
    await expect(
      resolveNativeConfiguration(
        { salesChannelId: "sc_a", regionId: "reg_ugx", currency: "UGX" },
        "ei_tradestaging01",
        {
          latestForEngine: async () => [
            attestedFrom(scope),
            attestedFrom(other, "6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e"),
          ],
        },
        facts(),
      ),
    ).rejects.toThrow(/several/)
    await expect(
      resolveNativeConfiguration(
        { salesChannelId: "sc_a", regionId: "reg_ugx", currency: "UGX" },
        "ei_tradestaging01",
        {
          latestForEngine: async () => [
            attestedFrom({ ...scope, engineInstanceId: "ei_tradeother01" }),
          ],
        },
        facts(),
      ),
    ).rejects.toThrow(/canonical v1 document for this engine/)
  })
})
