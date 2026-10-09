import { afterEach, describe, expect, it, vi } from "vitest"
import { HttpLegalActorAssessmentClient, type LegalActorAssessmentPort } from "../src/baobab/control-plane/legal-actor-assessment"
import {
  GovernedMedusaOrderOrchestrationAdapter,
  type GovernedSellerOrderCommand,
  type LegalSellerProviderReadiness,
} from "../src/baobab/orders/governed-legal-seller"
import type { OrderOrchestrationPort, OrderSnapshot } from "../src/baobab/orders/orchestration-port"

const now = Date.parse("2026-10-09T14:00:00Z")
const command: GovernedSellerOrderCommand = {
  orderReference: "order-01", organisationId: "org-zuribeans", marketKey: "zuribeans_za",
  marketCode: "ZA", legalActivity: "B2B_COFFEE_SALE",
  legalCapability: "commerce.order.create",
  legalContextId: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b",
  legalSellerKey: "LE-SYNTHETIC-ZA", currencyCode: "ZAR",
  totalMinor: 15000, idempotencyKey: "test/order/01", correlationId: "test-correlation",
}
const fact = () => ({
  context_id: command.legalContextId, operation_reference: command.orderReference,
  provider_permissions_granted: false as const,
  legal_actor_resolution: {
    outcome: "AUTHORIZED", evaluated_at: new Date(now).toISOString(),
    policy_reference: "ADR-BCP-027/LA-04A/fail-closed-legal-actor-resolution",
    mandate_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c",
    responsible_legal_entity_id: "LE-SYNTHETIC-ZA",
    evidence_references: ["test/verified-legal-entity"],
    valid_until: new Date(now + 20_000).toISOString(),
  },
})

afterEach(() => vi.unstubAllGlobals())

describe("LA-05C legal-seller PEP", () => {
  const setup = (overrides: Record<string, unknown> = {}, ready = true) => {
    const place = vi.fn(async (cmd: GovernedSellerOrderCommand): Promise<OrderSnapshot> =>
      ({ ...cmd, id: "order-record-01", status: "PENDING" }))
    const native: OrderOrchestrationPort = {
      place, retrieve: vi.fn(async () => ({ ...command, id: "order-record-01", status: "PENDING" })),
    }
    const assess = vi.fn(async () => ({ ...fact(), ...overrides }))
    const cp: LegalActorAssessmentPort = { assess }
    const seller = vi.fn(async () => {
      if (!ready) throw new Error("Provider merchant not onboarded")
    })
    const readiness: LegalSellerProviderReadiness = { assertReadyForSeller: seller }
    const adapter = new GovernedMedusaOrderOrchestrationAdapter(native, cp,
      { getAccessToken: async () => "workload-token" }, readiness, () => now)
    return { adapter, place, assess, seller }
  }

  it("requires fresh CP authority, exact actor and separately confirmed provider before placing, even on replay", async () => {
    const t = setup()
    await t.adapter.place(command)
    await t.adapter.place(command)
    expect(t.assess).toHaveBeenCalledTimes(2)
    expect(t.seller).toHaveBeenCalledTimes(2)
    expect(t.place).toHaveBeenCalledTimes(2)
    expect(t.assess).toHaveBeenCalledWith({
      context_id: command.legalContextId, role: "SELLER_OF_RECORD",
      activity: "B2B_COFFEE_SALE", market: "ZA",
      capability: "commerce.order.create", operation_reference: "order-01",
    }, "workload-token", command.correlationId)
  })

  it("rejects absent or stale authority, wrong actor, denied outcomes, and provider failures before calling native Medusa", async () => {
    const denied = [
      { legal_actor_resolution: { ...fact().legal_actor_resolution, outcome: "REVOKED_OR_EXPIRED" } },
      { legal_actor_resolution: { ...fact().legal_actor_resolution, responsible_legal_entity_id: "LE-OTHER" } },
      { legal_actor_resolution: { ...fact().legal_actor_resolution, valid_until: new Date(now - 1).toISOString() } },
      { provider_permissions_granted: true },
      { context_id: "other-context" },
      { operation_reference: "other-order" },
    ]
    for (const changed of denied) {
      const t = setup(changed)
      await expect(t.adapter.place(command)).rejects.toThrow("Legal seller authority denied")
      expect(t.place).not.toHaveBeenCalled()
    }
    const unavailable = setup({}, false)
    await expect(unavailable.adapter.place(command)).rejects.toThrow("Provider merchant not onboarded")
    expect(unavailable.place).not.toHaveBeenCalled()
  })

  it("refuses to default a tenant or legal actor from a storefront alias when context is missing", async () => {
    const t = setup()
    await expect(t.adapter.place(({ ...command, legalContextId: "" } as GovernedSellerOrderCommand))).rejects.toThrow("context missing")
    expect(t.assess).not.toHaveBeenCalled()
  })
})

describe("LA-05C HTTP CP assessor", () => {
  it("sends only the canonical context-owned request with workload token and no-cache", async () => {
    const request = {
      context_id: command.legalContextId, role: "SELLER_OF_RECORD" as const,
      activity: command.legalActivity, market: command.marketCode,
      capability: command.legalCapability, operation_reference: command.orderReference,
    }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => fact() }))
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpLegalActorAssessmentClient("https://control-plane.example")
    await expect(client.assess(request, "workload-token", command.correlationId)).resolves.toMatchObject(fact())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://control-plane.example/internal/legal-actor/v1/assess")
    expect(init.headers).toMatchObject({ "cache-control": "no-store" })
    expect(init.headers).toMatchObject({ authorization: "Bearer workload-token" })
    expect(JSON.parse(init.body as string)).toEqual(request)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("refuses CP errors and malformed successful responses", async () => {
    const request = {
      context_id: command.legalContextId, role: "SELLER_OF_RECORD" as const,
      activity: command.legalActivity, market: command.marketCode,
      capability: command.legalCapability, operation_reference: command.orderReference,
    }
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })))
    const client = new HttpLegalActorAssessmentClient("https://control-plane.example")
    await expect(client.assess(request, "token", "corr")).rejects.toThrow("unavailable or denied")
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...fact(), provider_permissions_granted: true }) })))
    await expect(client.assess(request, "token", "corr")).rejects.toThrow("fail closed")
    expect(() => new HttpLegalActorAssessmentClient("http://untrusted.example")).toThrow("HTTPS")
  })
})
