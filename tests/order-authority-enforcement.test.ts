import { describe, expect, it, vi } from "vitest"
import type { OrderAuthorityDecision } from "../src/baobab/control-plane/trade-order-authority"
import {
  enforceOrderAuthority,
  OrderAuthorityDenied,
  tradeAuthorityProblem,
  type OrderAuthorityEnforcementDependencies,
  type OrderAuthorityReceipt,
} from "../src/baobab/orders/order-authority-enforcement"
import { canonicalNativeSellerConfiguration } from "../src/baobab/orders/native-seller-configuration"

const org = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c"
const contextId = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a01"
const B1 = "3f9a1c2e-7b4d-4e8a-9c1f-2d6e5b4a3c21"
const scope = {
  reference: "trade:seller-config/synthetic-01/v2",
  tenantId: "tn_synthetic01",
  organisationId: org,
  market: "UG",
  engineInstanceId: "ei_tradestaging01",
  currencyScope: ["UGX"],
  salesChannelIds: ["sc_a"],
  regionIds: ["reg_ugx"],
}
const facts = {
  salesChannels: [{ id: "sc_a", is_disabled: false }],
  regions: [{ id: "reg_ugx", currency_code: "ugx", countries: ["ug"] }],
}
const canonical = canonicalNativeSellerConfiguration(scope, facts.salesChannels, facts.regions)
const native = { salesChannelId: "sc_a", regionId: "reg_ugx", currency: "UGX" }
const operation = "trade/trade.order.commit/cart_01/r1/a1"

type Over = Partial<OrderAuthorityDecision> & { __throw?: boolean }

const deps = (
  decisionOver: Over = {},
  over: Partial<OrderAuthorityEnforcementDependencies> = {},
) => {
  const receipts: Omit<OrderAuthorityReceipt, "receipt_id">[] = []
  const requests: unknown[] = []
  const now = Date.now()
  const d: OrderAuthorityEnforcementDependencies = {
    engineInstanceId: "ei_tradestaging01",
    environment: { node: "test", enabled: "true" },
    attested: {
      latestForEngine: async () => [
        {
          attestation_id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
          native_configuration_reference: scope.reference,
          canonical_configuration: canonical.canonical,
        },
      ],
    },
    facts: { read: async () => facts },
    tokens: { getAccessToken: async () => "workload-token" },
    controlPlane: {
      resolvePlatformContext: async (tenantId: string, organisationId: string) => ({
        context_id: contextId,
        tenant_id: tenantId,
        organisation_id: organisationId,
        organisation_type: "ORGANISATION",
        country_code: "UG",
        resolved_at: new Date(now).toISOString(),
        expires_at: new Date(now + 60_000).toISOString(),
      }),
    },
    authority: {
      resolveBinding: async (req) => ({
        resolution_id: "4a6b8c0d-2e4f-4a6b-8c0d-2e4f6a8b0c2d",
        ...req,
        outcome: "RESOLVED" as const,
        binding_reference: { binding_id: B1, binding_version: 2 },
        status: "ACTIVE" as const,
        effective_from: "2026-10-16T00:00:00Z",
        resolved_at: new Date(now).toISOString(),
        provider_permissions_granted: false as const,
      }),
      resolveOrderAuthority: vi.fn(async (req) => {
        requests.push(req)
        if (decisionOver.__throw) throw new Error("CP down")
        const rest = { ...decisionOver }
        delete rest.__throw
        return {
          receivedAt: now,
          decision: {
            decision_id: "b4e9c7d1-5b2f-4e6a-8c1d-9f0b7e3a2c55",
            ...req,
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
            evaluated_at: new Date(now).toISOString(),
            expires_at: new Date(now + 20_000).toISOString(),
            policy_reference: "ADR-SHARED-039/trade-order-authority:v1",
            provider_permissions_granted: false,
            ...rest,
          } as OrderAuthorityDecision,
        }
      }),
    },
    store: {
      current: async () => null,
      record: async (a) => ({ attribution_id: "6c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f", ...a }),
    },
    receipts: {
      record: async (r) => {
        receipts.push(r)
        return { receipt_id: "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a", ...r }
      },
    },
    now: () => now,
    ...over,
  }
  return { d, receipts, requests, now }
}

describe("TA-05 order-authority enforcement point", () => {
  it("records a receipt binding the CP decision to the attribution and exact operation", async () => {
    const { d, receipts, requests, now } = deps()
    const r = await enforceOrderAuthority(
      "trade.order.commit",
      { type: "cart", id: "cart_01" },
      native,
      operation,
      d,
    )
    expect(requests[0]).toEqual({
      context_id: contextId,
      engine_instance_id: "ei_tradestaging01",
      operation_class: "trade.order.commit",
      seller_operating_binding_reference: { binding_id: B1, binding_version: 2 },
      native_configuration_digest: canonical.digest,
      currency: "UGX",
      operation_reference: operation,
    })
    expect(receipts[0]).toMatchObject({
      decision_id: "b4e9c7d1-5b2f-4e6a-8c1d-9f0b7e3a2c55",
      mandate_id: "7d2b9e4f-6a1c-4f3e-b8d5-0c9a8e7f6d21",
      responsible_legal_entity_id: "SYNTHETIC-LE-01",
      binding_id: B1,
      binding_version: 2,
      operation_reference: operation,
    })
    // Lease is min(CP expiry, receipt + 30 s).
    expect(Date.parse(r.lease_expires_at)).toBe(now + 20_000)
  })

  it("binds each class to its own native record type", async () => {
    for (const [cls, type] of [
      ["trade.order.create", "order"],
      ["trade.draft-order.finalize", "draft_order"],
    ] as const) {
      const { d, receipts } = deps({ operation_class: cls })
      await enforceOrderAuthority(
        cls,
        { type, id: `${type}_01` },
        native,
        `trade/${cls}/${type}_01/r1/a1`,
        d,
      )
      expect(receipts[0].operation_class).toBe(cls)
    }
    const { d, requests } = deps()
    await expect(
      enforceOrderAuthority(
        "trade.order.commit",
        { type: "order", id: "order_01" },
        native,
        operation,
        d,
      ),
    ).rejects.toMatchObject({
      outcome: "UNCATALOGUED_OPERATION",
      problem: { status: 403, code: "TRADE_OPERATION_NOT_AUTHORISED" },
    })
    await expect(
      enforceOrderAuthority(
        "trade.order.manage" as never,
        { type: "cart", id: "cart_01" },
        native,
        operation,
        d,
      ),
    ).rejects.toMatchObject({ outcome: "UNCATALOGUED_OPERATION" })
    expect(requests).toHaveLength(0)
  })

  it.each([
    ["production", { node: "production", enabled: "true" }],
    ["unknown profile", { baobab: "preview", enabled: "true" }],
    ["no profile", { enabled: "true" }],
    ["not enabled", { node: "test" }],
  ])("stays closed in %s before any CP call", async (_n, environment) => {
    const { d, requests, receipts } = deps({}, { environment })
    await expect(
      enforceOrderAuthority(
        "trade.order.commit",
        { type: "cart", id: "cart_01" },
        native,
        operation,
        d,
      ),
    ).rejects.toMatchObject({ outcome: "PROTECTED_RUNTIME", problem: { status: 403 } })
    expect(requests.length + receipts.length).toBe(0)
  })

  it.each([
    ["NO_APPLICABLE_MANDATE", { outcome: "NO_APPLICABLE_MANDATE" }, 403],
    ["BINDING_NOT_ACTIVE", { outcome: "BINDING_NOT_ACTIVE" }, 403],
    ["OPERATION_NOT_ACTIVATED", { outcome: "OPERATION_NOT_ACTIVATED" }, 403],
    ["REVOKED_OR_EXPIRED", { expires_at: new Date(Date.now() - 1).toISOString() }, 403],
    ["REVOKED_OR_EXPIRED", { tenant_id: "tn_othertenant" }, 403],
    ["REVOKED_OR_EXPIRED", { legal_actor_role: "PAYMENT_BENEFICIARY" }, 403],
    ["UNAVAILABLE", { __throw: true }, 503],
  ] as const)("denies %s and records no receipt", async (outcome, over, status) => {
    const { d, receipts } = deps(over as Over)
    const error = await enforceOrderAuthority(
      "trade.order.commit",
      { type: "cart", id: "cart_01" },
      native,
      operation,
      d,
    ).catch((e) => e)
    expect(error).toBeInstanceOf(OrderAuthorityDenied)
    expect(error.outcome).toBe(outcome)
    expect(error.problem.status).toBe(status)
    expect(receipts).toHaveLength(0)
  })

  it("propagates attribution denials as forbidden without calling order authority", async () => {
    const { d, requests } = deps(
      {},
      {
        store: {
          current: async () => ({ binding_id: "9b1c3d5e-7f9a-4b2c-8d4e-6f8a0b2c4d6e" }) as never,
          record: async () => {
            throw new Error("unreachable")
          },
        },
      },
    )
    await expect(
      enforceOrderAuthority(
        "trade.order.commit",
        { type: "cart", id: "cart_01" },
        native,
        operation,
        d,
      ),
    ).rejects.toMatchObject({
      outcome: "SELLER_CHANGED",
      problem: { status: 403, code: "TRADE_SELLER_CHANGED" },
    })
    expect(requests).toHaveLength(0)
    await expect(
      enforceOrderAuthority(
        "trade.order.commit",
        { type: "cart", id: "cart_01" },
        native,
        "has space",
        deps().d,
      ),
    ).rejects.toMatchObject({ outcome: "INVALID_OPERATION_REFERENCE" })
  })

  it.each([
    ["connection unavailable", { code: "ECONNREFUSED", message: "private connection URL" }],
    ["conflicting receipt", { code: "23505", detail: "private operation reference" }],
    ["guard refusal", { code: "P0001", message: "private attribution details" }],
  ])("denies a %s without leaking or retrying persistence errors", async (_name, failure) => {
    const record = vi.fn(async () => {
      throw failure
    })
    const { d, requests } = deps({}, { receipts: { record } })
    const error = await enforceOrderAuthority(
      "trade.order.commit",
      { type: "cart", id: "cart_01" },
      native,
      operation,
      d,
    ).catch((cause) => cause)
    expect(error).toBeInstanceOf(OrderAuthorityDenied)
    expect(error).toMatchObject({
      outcome: "UNAVAILABLE",
      problem: {
        status: 503,
        code: "TRADE_AUTHORITY_UNAVAILABLE",
      },
    })
    expect(record).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(1)
    expect(String(error) + JSON.stringify(error)).not.toContain("private")
    expect(error).not.toHaveProperty("cause")
  })

  it("maps outcomes to the ADR-SHARED-039 §6 statuses", () => {
    expect(tradeAuthorityProblem("UNAVAILABLE").status).toBe(503)
    expect(tradeAuthorityProblem("OPERATION_NOT_ACTIVATED")).toMatchObject({
      status: 403,
      code: "TRADE_OPERATION_NOT_AUTHORISED",
    })
    expect(tradeAuthorityProblem("INVALID_LIFECYCLE_STATE").status).toBe(409)
    expect(tradeAuthorityProblem("BINDING_SCOPE_MISMATCH")).toMatchObject({
      status: 403,
      code: "TRADE_BINDING_SCOPE_MISMATCH",
    })
  })
})
