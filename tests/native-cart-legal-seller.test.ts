import { describe, expect, it, vi } from "vitest"
import type { LegalActorAssessmentPort } from "../src/baobab/control-plane/legal-actor-assessment"
import type { DocumentaryRestrictionPort } from "../src/baobab/control-plane/documentary-restriction"
import {
  assertNativeCartLegalSeller,
  enforceNativeCheckoutGate,
  resolveNativeCheckoutEnvironment,
  type NativeCartLegalSellerDependencies,
} from "../src/baobab/orders/native-cart-legal-seller"
import type { GovernedSellerOrderCommand } from "../src/baobab/orders/governed-legal-seller"

const now = Date.parse("2026-10-09T14:00:00Z")
const cart = {
  id: "cart-synthetic-1",
  sales_channel_id: "sc-zuri-synthetic",
  region_id: "region-za-synthetic",
}
const cmd: GovernedSellerOrderCommand & {
  cartId: string
  salesChannelId: string | null
  regionId: string | null
  tenantId: string
} = {
  cartId: cart.id,
  salesChannelId: cart.sales_channel_id,
  regionId: cart.region_id,
  orderReference: `cart/${cart.id}/complete`,
  organisationId: "org-synthetic",
  tenantId: "tn_synthetic",
  marketKey: "za",
  legalSellerKey: "LE-SYNTHETIC-ZA",
  currencyCode: "ZAR",
  totalMinor: 1200,
  idempotencyKey: "checkout/synthetic",
  correlationId: "test-correlation",
  legalContextId: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b",
  marketCode: "ZA",
  legalActivity: "B2B_COFFEE_SALE",
  legalCapability: "commerce.order.create",
}

const approved = () => ({
  context_id: cmd.legalContextId,
  operation_reference: cmd.orderReference,
  provider_permissions_granted: false as const,
  legal_actor_resolution: {
    outcome: "AUTHORIZED",
    evaluated_at: new Date(now).toISOString(),
    policy_reference: "policy/legal-actor-synthetic",
    mandate_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c",
    responsible_legal_entity_id: cmd.legalSellerKey,
    evidence_references: ["synthetic/evidence"],
    valid_until: new Date(now + 20_000).toISOString(),
  },
})

const setup = () => {
  const resolveForCart = vi.fn(async () => cmd)
  const assess = vi.fn(async () => approved())
  const token = vi.fn(async () => "staging-workload-token")
  const ready = vi.fn(async () => undefined)
  const documentary = vi.fn(async () => ({
    context_id: cmd.legalContextId,
    organisation_id: cmd.organisationId,
    capability: cmd.legalCapability,
    market: cmd.marketCode,
    operation_reference: cmd.orderReference,
    blocked: false,
    authority_granted: false as const,
    policy_reference: "ADR-BCP-026/PEO-02T:negative-only",
    evaluated_at: new Date(now).toISOString(),
    expires_at: new Date(now + 1500).toISOString(),
  }))
  const deps: NativeCartLegalSellerDependencies = {
    bindings: { resolveForCart },
    cp: { assess } as LegalActorAssessmentPort,
    documentary: { assess: documentary } as DocumentaryRestrictionPort,
    tokens: { getAccessToken: token },
    readiness: { assertReadyForSeller: ready },
    now: () => now,
  }
  return { deps, resolveForCart, assess, documentary, token, ready }
}

describe("LA-05C8 native checkout deployment authority", () => {
  it("treats missing, unknown and contradictory runtime profiles as protected", async () => {
    const unknown = [
      {},
      { node: "development", baobab: "preview" },
      { node: "development", baobab: "test" },
      { node: "integration", deployment: "development" },
      { node: "testing" },
      { node: "test", deployment: "production" },
      { node: "integration", baobab: "PRODUCTION" },
    ]
    const missing = () => {
      throw new Error("no trusted provider")
    }
    for (const candidate of unknown) {
      const state = resolveNativeCheckoutEnvironment(candidate)
      expect(state).toEqual({ production: true, staging: false })
      await expect(
        enforceNativeCheckoutGate(cart, false, state.production, missing, state.staging),
      ).rejects.toThrow("not production-certified")
    }
  })

  it("requires full seller gate for staging and retains local synthetic test exemptions", async () => {
    for (const candidate of [
      { node: "development", deployment: "staging" },
      { node: "test", baobab: "staging" },
    ]) {
      const mode = resolveNativeCheckoutEnvironment(candidate)
      expect(mode).toEqual({ production: false, staging: true })
      await expect(
        enforceNativeCheckoutGate(cart, false, mode.production, () => setup().deps, mode.staging),
      ).rejects.toThrow("staging requires governed seller gate")
    }
    for (const local of ["development", "test", "integration"]) {
      const mode = resolveNativeCheckoutEnvironment({ node: local, deployment: local })
      expect(mode).toEqual({ production: false, staging: false })
    }
  })
})

describe("LA-05C2 native Medusa checkout guard", () => {
  it("authorizes only a trusted cart-bound operation and rechecks after provider readiness", async () => {
    const t = setup()
    await assertNativeCartLegalSeller(cart, t.deps)
    expect(t.resolveForCart).toHaveBeenCalledWith({
      cartId: cart.id,
      salesChannelId: cart.sales_channel_id,
      regionId: cart.region_id,
    })
    expect(t.assess).toHaveBeenCalledTimes(2)
    expect(t.token).toHaveBeenCalledTimes(4)
    expect(t.documentary).toHaveBeenCalledTimes(2)
    expect(t.ready).toHaveBeenCalledTimes(1)
    expect(t.assess).toHaveBeenCalledWith(
      {
        context_id: cmd.legalContextId,
        role: "SELLER_OF_RECORD",
        activity: cmd.legalActivity,
        market: cmd.marketCode,
        capability: cmd.legalCapability,
        operation_reference: cmd.orderReference,
      },
      "staging-workload-token",
      cmd.correlationId,
    )
  })

  it("denies missing, mismatched or client-aliased context BEFORE calling CP", async () => {
    for (const change of [
      { cartId: "another-cart" },
      { regionId: "region-ug" },
      { salesChannelId: "another-sales-channel" },
      { orderReference: "storefront/order-id" },
      { legalContextId: "" },
      { marketCode: "zuribeans_za" },
    ]) {
      const t = setup()
      t.resolveForCart.mockResolvedValueOnce({ ...cmd, ...change })
      await expect(assertNativeCartLegalSeller(cart, t.deps)).rejects.toThrow(
        "trusted cart binding",
      )
      expect(t.assess).not.toHaveBeenCalled()
      expect(t.ready).not.toHaveBeenCalled()
    }
  })

  it("denies negative remediation holds and a hold imposed while Payments is pending", async () => {
    const held = setup()
    held.documentary.mockResolvedValueOnce({
      context_id: cmd.legalContextId,
      organisation_id: cmd.organisationId,
      capability: cmd.legalCapability,
      market: cmd.marketCode,
      operation_reference: cmd.orderReference,
      blocked: true,
      authority_granted: false as const,
      policy_reference: "ADR-BCP-026/PEO-02T:negative-only",
      evaluated_at: new Date(now).toISOString(),
      expires_at: new Date(now + 1500).toISOString(),
    })
    await expect(assertNativeCartLegalSeller(cart, held.deps)).rejects.toThrow(
      "Documentary restriction denied",
    )
    expect(held.ready).not.toHaveBeenCalled()
    const revokedMidflight = setup()
    revokedMidflight.documentary.mockResolvedValueOnce({
      context_id: cmd.legalContextId,
      organisation_id: cmd.organisationId,
      capability: cmd.legalCapability,
      market: cmd.marketCode,
      operation_reference: cmd.orderReference,
      blocked: false,
      authority_granted: false as const,
      policy_reference: "ADR-BCP-026/PEO-02T:negative-only",
      evaluated_at: new Date(now).toISOString(),
      expires_at: new Date(now + 1500).toISOString(),
    })
    revokedMidflight.documentary.mockResolvedValueOnce({
      context_id: cmd.legalContextId,
      organisation_id: cmd.organisationId,
      capability: cmd.legalCapability,
      market: cmd.marketCode,
      operation_reference: cmd.orderReference,
      blocked: true,
      authority_granted: false as const,
      policy_reference: "ADR-BCP-026/PEO-02T:negative-only",
      evaluated_at: new Date(now).toISOString(),
      expires_at: new Date(now + 1500).toISOString(),
    })
    await expect(assertNativeCartLegalSeller(cart, revokedMidflight.deps)).rejects.toThrow(
      "Documentary restriction denied",
    )
    expect(revokedMidflight.ready).toHaveBeenCalledTimes(1)
    expect(revokedMidflight.documentary).toHaveBeenCalledTimes(2)
  })

  it("denies revocation or mandate replacement occurring during provider readiness", async () => {
    const revoked = setup()
    revoked.assess.mockResolvedValueOnce(approved())
    revoked.assess.mockResolvedValueOnce({
      ...approved(),
      legal_actor_resolution: {
        ...approved().legal_actor_resolution,
        outcome: "REVOKED_OR_EXPIRED",
      },
    })
    await expect(assertNativeCartLegalSeller(cart, revoked.deps)).rejects.toThrow(
      "Legal seller authority denied",
    )
    const switched = setup()
    switched.assess.mockResolvedValueOnce(approved())
    switched.assess.mockResolvedValueOnce({
      ...approved(),
      legal_actor_resolution: {
        ...approved().legal_actor_resolution,
        mandate_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a7d",
      },
    })
    await expect(assertNativeCartLegalSeller(cart, switched.deps)).rejects.toThrow(
      "mandate changed before commit",
    )
  })

  it("denies an ACTIVE cart binding revoked while Payments readiness is pending", async () => {
    const t = setup()
    t.resolveForCart.mockResolvedValueOnce(cmd)
    t.resolveForCart.mockRejectedValueOnce(new Error("LA-05C3 denied: revoked"))
    await expect(assertNativeCartLegalSeller(cart, t.deps)).rejects.toThrow("revoked")
    expect(t.assess).toHaveBeenCalledTimes(1)
    expect(t.ready).toHaveBeenCalledTimes(1)
    expect(t.resolveForCart).toHaveBeenCalledTimes(2)
  })

  it("denies seller, market, currency or context changed during provider wait", async () => {
    for (const change of [
      { legalSellerKey: "LE-OTHER" },
      { marketCode: "UG" },
      { currencyCode: "UGX" },
      { legalContextId: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5abc" },
      { organisationId: "org-other" },
      { idempotencyKey: "a-different-operation" },
    ]) {
      const t = setup()
      t.resolveForCart.mockResolvedValueOnce(cmd)
      t.resolveForCart.mockResolvedValueOnce({ ...cmd, ...change })
      await expect(assertNativeCartLegalSeller(cart, t.deps)).rejects.toThrow(
        "cart binding changed or revoked",
      )
      expect(t.assess).toHaveBeenCalledTimes(1)
    }
  })

  it("refuses native checkout when independent seller/provider readiness denies", async () => {
    const t = setup()
    t.ready.mockRejectedValueOnce(new Error("PSP merchant not verified"))
    await expect(assertNativeCartLegalSeller(cart, t.deps)).rejects.toThrow(
      "PSP merchant not verified",
    )
    expect(t.assess).toHaveBeenCalledTimes(1)
  })

  it("is default-off but fails closed if staged without dependencies or in production", async () => {
    const missing = () => {
      throw new Error("no binding")
    }
    await expect(enforceNativeCheckoutGate(cart, false, false, missing)).resolves.toBeUndefined()
    await expect(enforceNativeCheckoutGate(cart, false, false, missing, true)).rejects.toThrow(
      "staging requires governed seller gate",
    )
    await expect(enforceNativeCheckoutGate(cart, true, false, missing, true)).rejects.toThrow(
      "trusted dependency not registered",
    )
    // Production is fail-closed EVEN when the rollout flag is missing/false:
    // a disabled gate must not silently restore Medusa's ungoverned issuer.
    await expect(enforceNativeCheckoutGate(cart, false, true, missing)).rejects.toThrow(
      "not production-certified",
    )
    await expect(enforceNativeCheckoutGate(cart, true, true, missing)).rejects.toThrow(
      "not production-certified",
    )
    await expect(enforceNativeCheckoutGate(cart, true, false, missing)).rejects.toThrow(
      "trusted dependency not registered",
    )
    const t = setup()
    await expect(
      enforceNativeCheckoutGate(cart, true, false, () => t.deps),
    ).resolves.toBeUndefined()
  })
})
