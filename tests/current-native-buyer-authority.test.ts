import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  CurrentNativeBuyerAuthority,
  type CurrentNativeBuyerAuthorityDependencies,
  type NativeBuyerPurchase,
} from "../src/baobab/b2b/current-native-buyer-authority"
import { requireCurrentNativeCommitAuthority } from "../src/baobab/b2b/native-commit-authority-readback"
import { buyerExecutionContextSchema } from "../src/baobab/contracts/authority-validation"
import { syntheticCommitmentProof, valuationFacts, NOW } from "./fixtures/native-buyer-commitment"

/** Unit ports only. Real policy loading/evaluation and schema validation run;
 * these tests do not claim actual issuer, CP, pricing or native execution. */
const ports = vi.hoisted(() => ({ identity: vi.fn(), seller: vi.fn(), configuration: vi.fn() }))
vi.mock("../src/baobab/b2b/buyer-authority", () => ({ resolveBuyerCommitIdentity: ports.identity }))
vi.mock("../src/baobab/orders/order-authority-enforcement", () => ({
  enforceOrderAuthority: ports.seller,
}))
vi.mock("../src/baobab/orders/native-configuration-resolver", () => ({
  resolveNativeConfiguration: ports.configuration,
}))

const reference = syntheticCommitmentProof()
const marketKey = "zuribeans_ug"
const request = {
  callerToken: "synthetic-unit-caller",
  subjectToken: "synthetic-unit-subject",
  requestedOrganisationId: reference.context.canonical_organisation_id,
  requestedCountryCode: "UG",
  correlationId: reference.context.correlation_id,
}
const period = { start: "2026-11-01T00:00:00Z", end: "2026-12-01T00:00:00Z" }
const grant = { status: "ACTIVE", effective_from: null, effective_until: null }

function world() {
  let now = NOW.getTime()
  const { decision, ...identity } = structuredClone(reference.context)
  if (decision.outcome !== "ALLOW") throw new Error("Invalid unit reference")
  identity.market_id = "market_ug"
  // Evidence vocabulary here is synthetic but deliberately uses CP-shaped
  // references: shape validation itself is never authentication evidence.
  identity.evidence_references = ["cp-context:unit-only-1111"]
  ports.identity.mockImplementation(async () => ({ outcome: "RESOLVED", identity }))
  ports.seller.mockImplementation(async () => structuredClone(reference.seller))
  ports.configuration.mockImplementation(async () => ({
    digest: reference.seller.native_configuration_digest,
    tenantId: reference.seller.tenant_id,
    organisationId: reference.seller.operating_organisation_id,
    market: "UG",
    currency: "UGX",
  }))
  const purchase: NativeBuyerPurchase = {
    native: { salesChannelId: "sc_unit", regionId: "reg_unit", currency: "UGX" },
    operationReference: reference.receipt.operation_reference,
    marketKey,
    valuation: structuredClone(valuationFacts),
    reservationId: reference.receipt.spend_reservation_id,
    holdRevision: 1,
    sites: [{ siteId: "b2bsite_unit111", use: "SHIPPING" }],
  }
  const deps: CurrentNativeBuyerAuthorityDependencies = {
    now: () => now,
    buyer: {} as never,
    tokens: { getAccessToken: vi.fn(async () => "unit-only-workload") },
    readPurchase: vi.fn(async () => structuredClone(purchase)),
    markets: {
      getMarket: vi.fn(async () => ({
        market_id: "market_ug",
        canonical_key: marketKey,
        name: "Unit market",
        owner_tenant_id: identity.tenant_id,
        market_type: "B2B" as const,
        countries: ["UG"],
        allowed_currencies: ["UGX"],
        status: "ACTIVE" as const,
        revision: 1,
        effective_from: period.start,
        effective_to: null,
      })),
    },
    policies: {
      listBuyerRoles: vi.fn(async () => [{ id: "role_unit111", role: "BUYER" }]),
      listBuyerRoleMarketScopes: vi.fn(async () => [
        { buyer_role_id: "role_unit111", market_key: marketKey, ...grant },
      ]),
      listBuyerRoleSiteScopes: vi.fn(async () => [
        { buyer_role_id: "role_unit111", delivery_site_id: "b2bsite_unit111", ...grant },
      ]),
      listDeliverySites: vi.fn(async () => [
        {
          id: "b2bsite_unit111",
          organisation_id: identity.buyer_organisation_id,
          market_key: marketKey,
          status: "ACTIVE" as const,
          allow_shipping: true,
          allow_billing: false,
        },
      ]),
      listSpendLimits: vi.fn(async () => [
        {
          market_key: marketKey,
          currency_code: "UGX",
          order_limit_minor: "2000000",
          approval_limit_minor: null,
          effective_from: null,
          effective_until: null,
        },
      ]),
      listApprovalPolicies: vi.fn(async () => []),
      listPurchaseOrderRequirements: vi.fn(async () => []),
      listSpendBudgetPolicies: vi.fn(async () => [
        {
          id: "budget_unit111",
          revision: 1,
          status: "ACTIVE",
          scope: "MEMBERSHIP",
          membership_id: identity.buyer_membership_id,
          agreement_reference: null,
          market_key: marketKey,
          currency_code: "UGX",
          limit_minor: "2000000",
          effective_from: period.start,
          effective_until: null,
        },
      ]),
      listSpendBudgetBalances: vi.fn(async () => [
        {
          budget_policy_id: "budget_unit111",
          period_starts_at: period.start,
          period_ends_at: period.end,
          committed_minor: "0",
          reserved_minor: "1250000",
        },
      ]),
      listSpendReservations: vi.fn(async () => [
        {
          id: purchase.reservationId,
          tenant_id: identity.tenant_id,
          purchase_reference: valuationFacts.resource_id,
          hold_revision: 1,
          amount_minor: "1250000",
          organisation_id: identity.buyer_organisation_id,
          membership_id: identity.buyer_membership_id,
          market_key: marketKey,
          currency_code: "UGX",
          agreement_reference: null,
          transaction_digest: valuationFacts.transaction_digest,
          resource_version: valuationFacts.resource_version,
          status: "ACTIVE",
          expires_at: new Date(now + 60_000),
        },
      ]),
      listSpendReservationHolds: vi.fn(async () => [
        {
          budget_policy_id: "budget_unit111",
          policy_revision: 1,
          period_starts_at: period.start,
          reserved_minor: "1250000",
        },
      ]),
    },
    seller: {
      engineInstanceId: identity.engine_instance_id,
      tokens: { getAccessToken: async () => "unit-seller-token" },
      authority: {
        resolveOrderAuthority: vi.fn(async (input) => ({
          receivedAt: now,
          decision: {
            ...input,
            decision_id: "11111111-1111-4111-8111-111111111111",
            outcome: "AUTHORIZED",
            tenant_id: identity.tenant_id,
            operating_organisation_id: reference.seller.operating_organisation_id,
            market: "UG",
            legal_actor_role: "SELLER_OF_RECORD",
            activity: "CHECKOUT_ORDER_COMMITMENT",
            mandate_id: reference.seller.mandate_id,
            evidence_references: ["cp-mandate:unit-only-1111"],
            mandate_effective_from: period.start,
            responsible_legal_entity_id: reference.seller.responsible_legal_entity_id,
            evaluated_at: new Date(now).toISOString(),
            expires_at: new Date(now + 10_000).toISOString(),
            policy_reference: "ADR-SHARED-039/trade-order-authority:v1",
            provider_permissions_granted: false,
          },
        })),
        resolveBinding: vi.fn(),
      },
    } as unknown as CurrentNativeBuyerAuthorityDependencies["seller"],
  }
  return {
    deps,
    purchase,
    identity,
    provider: new CurrentNativeBuyerAuthority(deps, request),
    advance: (ms: number) => {
      now += ms
    },
  }
}

beforeEach(() => vi.clearAllMocks())
describe("current native buyer authority composition (unit ports, no connected claim)", () => {
  it("issues a complete canonical consequential context only after policy and seller ALLOW", async () => {
    const w = world()
    const a = await w.provider.authorizeNow()
    expect(buyerExecutionContextSchema(a.context)).toBe(true)
    expect(a.context.operation).toBe("trade.order.commit")
    expect(a.context.amount_minor).toBe(1250000)
    expect(a.receipt.correlation_id).toBe(request.correlationId)
    expect(a.receipt.spend_reservation_id).toBe(w.purchase.reservationId)
    expect(ports.seller).toHaveBeenCalledOnce()
    // A canonical Market key and ISO country are distinct, even in one order.
    expect(w.purchase.marketKey).not.toBe(a.seller.market)
  })
  it("rechecks online buyer and CP seller authority without issuing another seller receipt", async () => {
    const w = world()
    const a = await w.provider.authorizeNow()
    const current = await w.provider.recheckAuthorityNow(a)
    expect(() => requireCurrentNativeCommitAuthority(a, current, NOW.getTime())).not.toThrow()
    expect(ports.identity).toHaveBeenCalledTimes(2)
    expect(w.deps.markets.getMarket).toHaveBeenCalledTimes(2)
    expect(w.deps.readPurchase).toHaveBeenCalledTimes(2)
    expect(ports.seller).toHaveBeenCalledOnce()
    expect(w.deps.seller.authority.resolveOrderAuthority).toHaveBeenCalledOnce()
  })
  it.each([
    ["suspended", { status: "SUSPENDED" }],
    ["foreign tenant", { owner_tenant_id: "tn_foreign01" }],
    ["wrong canonical Market", { market_id: "market_other" }],
    ["local key drift", { canonical_key: "other_ug" }],
    ["country absent", { countries: [] }],
    ["currency absent", { allowed_currencies: [] }],
    ["expired", { effective_to: NOW.toISOString() }],
    ["future", { effective_from: new Date(NOW.getTime() + 1).toISOString() }],
  ] as const)("refuses a %s Market before requesting seller authority", async (_label, change) => {
    const w = world()
    const market = await w.deps.markets.getMarket("", "", "")
    vi.mocked(w.deps.markets.getMarket).mockResolvedValue({ ...market, ...change })
    await expect(w.provider.authorizeNow()).rejects.toThrow(
      "CURRENT_NATIVE_BUYER_AUTHORITY_NOT_PROVEN",
    )
    expect(ports.seller).not.toHaveBeenCalled()
  })
  it.each([
    "roles",
    "site grant",
    "spend limit",
    "budget",
    "reservation",
    "purchase order",
    "approval",
  ])("refuses missing or restricted %s before seller authority", async (kind) => {
    const w = world()
    if (kind === "roles") vi.mocked(w.deps.policies.listBuyerRoles).mockResolvedValue([])
    if (kind === "site grant")
      vi.mocked(w.deps.policies.listBuyerRoleSiteScopes).mockResolvedValue([])
    if (kind === "spend limit") vi.mocked(w.deps.policies.listSpendLimits).mockResolvedValue([])
    if (kind === "budget") vi.mocked(w.deps.policies.listSpendBudgetPolicies).mockResolvedValue([])
    if (kind === "reservation")
      vi.mocked(w.deps.policies.listSpendReservations).mockResolvedValue([])
    if (kind === "purchase order")
      vi.mocked(w.deps.policies.listPurchaseOrderRequirements).mockResolvedValue([
        { market_key: marketKey, required: true, format_pattern: null },
      ])
    if (kind === "approval")
      vi.mocked(w.deps.policies.listApprovalPolicies).mockResolvedValue([
        { market_key: marketKey, currency_code: "UGX", threshold_minor: "1", enabled: true },
      ])
    await expect(w.provider.authorizeNow()).rejects.toThrow(
      "CURRENT_NATIVE_BUYER_AUTHORITY_NOT_PROVEN",
    )
    expect(ports.seller).not.toHaveBeenCalled()
  })
  it("does not expose a credential-bearing dependency error", async () => {
    const w = world()
    vi.mocked(w.deps.markets.getMarket).mockRejectedValue(
      new Error("private-token-value https://private.test"),
    )
    await expect(w.provider.authorizeNow()).rejects.toThrow(
      /^CURRENT_NATIVE_BUYER_AUTHORITY_NOT_PROVEN$/,
    )
  })

  it.each([
    ["foreign tenant", { tenant_id: "tn_foreign01" }],
    ["different cart", { purchase_reference: "cart_other" }],
    ["hold rollover", { hold_revision: 2 }],
    ["changed reserved amount", { amount_minor: "1250001" }],
    ["expired hold", { expires_at: NOW.toISOString() }],
  ])("refuses a %s reservation before seller authority", async (_label, change) => {
    const w = world()
    const rows = await w.deps.policies.listSpendReservations({
      id: w.purchase.reservationId,
      organisation_id: w.identity.buyer_organisation_id,
    })
    vi.mocked(w.deps.policies.listSpendReservations).mockResolvedValue([{ ...rows[0], ...change }])
    await expect(w.provider.authorizeNow()).rejects.toThrow(
      "CURRENT_NATIVE_BUYER_AUTHORITY_NOT_PROVEN",
    )
    expect(ports.seller).not.toHaveBeenCalled()
  })
  it("refuses expiry during the seller call", async () => {
    const w = world()
    ports.seller.mockImplementation(async () => {
      w.advance(16_000)
      return structuredClone(reference.seller)
    })
    await expect(w.provider.authorizeNow()).rejects.toThrow(
      "CURRENT_NATIVE_BUYER_AUTHORITY_NOT_PROVEN",
    )
  })
  it("refuses a current CP seller denial after the initial ALLOW", async () => {
    const w = world()
    const a = await w.provider.authorizeNow()
    const resolve = w.deps.seller.authority.resolveOrderAuthority
    const prior = await resolve({} as never, "", "")
    vi.mocked(resolve).mockResolvedValue({
      ...prior,
      decision: { ...prior.decision, outcome: "NO_APPLICABLE_MANDATE" },
    })
    await expect(w.provider.recheckAuthorityNow(a)).rejects.toThrow(
      "CURRENT_NATIVE_BUYER_AUTHORITY_NOT_PROVEN",
    )
    expect(ports.seller).toHaveBeenCalledOnce()
  })
  it("refuses native configuration drift before the CP recheck", async () => {
    const w = world()
    const a = await w.provider.authorizeNow()
    ports.configuration.mockResolvedValue({ digest: "changed" })
    await expect(w.provider.recheckAuthorityNow(a)).rejects.toThrow(
      "CURRENT_NATIVE_BUYER_AUTHORITY_NOT_PROVEN",
    )
    expect(w.deps.seller.authority.resolveOrderAuthority).not.toHaveBeenCalled()
  })
})
