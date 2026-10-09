import { describe, expect, it, vi } from "vitest"
import type { LegalActorAssessmentPort } from "../src/baobab/control-plane/legal-actor-assessment"
import {
  assertNativeCartLegalSeller,
  enforceNativeCheckoutGate,
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
  const deps: NativeCartLegalSellerDependencies = {
    bindings: { resolveForCart },
    cp: { assess } as LegalActorAssessmentPort,
    tokens: { getAccessToken: token },
    readiness: { assertReadyForSeller: ready },
    now: () => now,
  }
  return { deps, resolveForCart, assess, token, ready }
}

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
    expect(t.token).toHaveBeenCalledTimes(2)
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
