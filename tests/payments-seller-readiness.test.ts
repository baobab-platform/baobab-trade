import { afterEach, describe, expect, it, vi } from "vitest"
import {
  assertCurrentPaymentsReadiness,
  HttpPaymentsMerchantReadinessAdapter,
} from "../src/baobab/orders/payments-seller-readiness"
import type {
  GovernedSellerOrderCommand,
  LegalSellerEvidence,
} from "../src/baobab/orders/governed-legal-seller"

const now = Date.parse("2026-10-10T00:00:00.000Z")
const cmd: GovernedSellerOrderCommand & { tenantId: string } = {
  tenantId: "tn_test",
  organisationId: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6a",
  legalContextId: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b",
  legalSellerKey: "NABHOLD-LEGAL-SYNTHETIC",
  legalActivity: "b2b-trade",
  legalCapability: "commerce.order.create",
  marketCode: "ZA",
  marketKey: "za",
  currencyCode: "ZAR",
  idempotencyKey: "cart-01",
  orderReference: "cart/cart-01/complete",
  correlationId: "corr-01",
  totalMinor: 1000,
}
const evidence: LegalSellerEvidence = {
  mandateId: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c",
  responsibleLegalEntityId: cmd.legalSellerKey,
  contextId: cmd.legalContextId,
  marketCode: cmd.marketCode,
  capability: cmd.legalCapability,
  operationReference: cmd.orderReference,
}
const decision = () => ({
  tenant_id: cmd.tenantId,
  organisation_id: cmd.organisationId,
  responsible_legal_entity_id: cmd.legalSellerKey,
  market: cmd.marketCode,
  currency_code: cmd.currencyCode,
  capability: cmd.legalCapability,
  operation_reference: cmd.orderReference,
  mandate_id: evidence.mandateId,
  outcome: "READY",
  provider_certification_reference: "synthetic/provider-certification",
  merchant_activation_reference: "synthetic/merchant-activation",
  policy_reference: "synthetic/independent-payments-policy",
  evaluated_at: new Date(now).toISOString(),
  valid_until: new Date(now + 20_000).toISOString(),
})

afterEach(() => vi.unstubAllGlobals())

describe("LA-05C3 independently authenticated Payments readiness", () => {
  const build = () =>
    new HttpPaymentsMerchantReadinessAdapter({
      url: "https://payments.example/internal/merchant-readiness/assess",
      tokens: { getAccessToken: async () => "audience-bound-payments-token" },
      now: () => now,
    })

  it("requires a live audience token and an exact operation-bound certified response", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => decision() }))
    vi.stubGlobal("fetch", f)
    await expect(build().assertReadyForSeller(cmd, evidence)).resolves.toBeUndefined()
    expect(f).toHaveBeenCalledTimes(1)
    const [url, options] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://payments.example/internal/merchant-readiness/assess")
    expect(options.headers).toMatchObject({
      authorization: "Bearer audience-bound-payments-token",
      "cache-control": "no-store",
    })
    expect(JSON.parse(options.body as string)).toMatchObject({
      tenant_id: cmd.tenantId,
      organisation_id: cmd.organisationId,
      responsible_legal_entity_id: cmd.legalSellerKey,
      operation_reference: cmd.orderReference,
      mandate_id: evidence.mandateId,
    })
  })

  it("rejects forged context, expired decision, missing activation and false readiness", () => {
    const expected = {
      tenant_id: cmd.tenantId,
      organisation_id: cmd.organisationId,
      responsible_legal_entity_id: cmd.legalSellerKey,
      market: cmd.marketCode,
      currency_code: cmd.currencyCode,
      capability: cmd.legalCapability,
      operation_reference: cmd.orderReference,
      mandate_id: evidence.mandateId,
    }
    for (const altered of [
      { organisation_id: "other" },
      { responsible_legal_entity_id: "other-actor" },
      { mandate_id: "other" },
      { merchant_activation_reference: "" },
      { outcome: "DENIED" },
      { valid_until: new Date(now - 1).toISOString() },
      { valid_until: new Date(now + 3600_000).toISOString() },
    ]) {
      expect(() =>
        assertCurrentPaymentsReadiness({ ...decision(), ...altered }, expected, now),
      ).toThrow("Payments readiness denied")
    }
  })

  it("fails closed on untrusted transport, absent tenant or remote provider failures", async () => {
    expect(
      () =>
        new HttpPaymentsMerchantReadinessAdapter({
          url: "http://payments.example/readiness",
          tokens: { getAccessToken: async () => "token" },
        }),
    ).toThrow("HTTPS")
    const invalidTenant: GovernedSellerOrderCommand & { tenantId: string } = {
      ...cmd,
      tenantId: "",
    }
    await expect(build().assertReadyForSeller(invalidTenant, evidence)).rejects.toThrow(
      "no authoritative tenant",
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 })),
    )
    await expect(build().assertReadyForSeller(cmd, evidence)).rejects.toThrow(
      "provider unavailable",
    )
  })
})
