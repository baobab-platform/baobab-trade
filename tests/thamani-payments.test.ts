import { describe, expect, it } from "vitest"
import { resolvePaymentProvider } from "../src/baobab/payments"
import {
  THAMANI_PAYMENT_POLICIES,
  assertRefundRequest,
  assertValidPaymentWebhook,
  signPaymentWebhook,
} from "../src/baobab/thamani/payments"

describe("Thamani Gate 11 payments", () => {
  it("keeps B2C prepaid and Market/currency scoped", () => {
    for (const policy of THAMANI_PAYMENT_POLICIES) {
      expect(policy.allowedTerms).toEqual(["PREPAID"])
      expect(resolvePaymentProvider(policy, "SELECTED_PSP", policy.currency).enabled).toBe(true)
      expect(() =>
        resolvePaymentProvider(policy, "SELECTED_PSP", policy.currency === "UGX" ? "ZAR" : "UGX"),
      ).toThrow("currency")
    }
  })
  it("keeps unapproved live regional adapters disabled", () => {
    const regional = THAMANI_PAYMENT_POLICIES.flatMap((policy) => policy.providers).filter(
      (provider) => provider.kind === "REGIONAL_ADAPTER",
    )
    expect(regional.length).toBeGreaterThan(0)
    expect(regional.every((provider) => !provider.enabled)).toBe(true)
  })
  it("accepts a signed current webhook and rejects tampering or replay", () => {
    const input = {
      providerKey: "sandbox",
      eventId: "evt-1",
      timestampSeconds: 1000,
      rawBody: '{"ok":true}',
    }
    const signature = signPaymentWebhook(input, "secret")
    expect(() => assertValidPaymentWebhook({ ...input, signature }, "secret", 1000)).not.toThrow()
    expect(() =>
      assertValidPaymentWebhook({ ...input, signature, rawBody: '{"ok":false}' }, "secret", 1000),
    ).toThrow("signature")
    expect(() => assertValidPaymentWebhook({ ...input, signature }, "secret", 1400)).toThrow(
      "replay",
    )
  })
  it("prevents cross-currency and excessive refunds", () => {
    const valid = {
      amountMinor: 2500,
      capturedAmountMinor: 10000,
      alreadyRefundedMinor: 1000,
      currency: "UGX",
      paymentCurrency: "UGX",
      reason: "CUSTOMER_RETURN" as const,
    }
    expect(() => assertRefundRequest(valid)).not.toThrow()
    expect(() => assertRefundRequest({ ...valid, currency: "ZAR" })).toThrow("currency")
    expect(() => assertRefundRequest({ ...valid, amountMinor: 9500 })).toThrow("exceeds")
  })
})
