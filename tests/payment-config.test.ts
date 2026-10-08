import { describe, expect, it } from "vitest"
import { ZURIBEANS_PAYMENT_POLICIES, resolvePaymentProvider } from "../src/baobab/payments"

describe("ZuriBeans payment policy", () => {
  it("isolates Market currency and regional provider eligibility", () => {
    expect(ZURIBEANS_PAYMENT_POLICIES).toHaveLength(2)
    const ug = ZURIBEANS_PAYMENT_POLICIES[0]
    const za = ZURIBEANS_PAYMENT_POLICIES[1]
    expect(ug.currency).toBe("UGX")
    expect(za.currency).toBe("ZAR")
    expect(ug.legalSellerKey).not.toBe(za.legalSellerKey)
    expect(resolvePaymentProvider(ug, "BANK_TRANSFER", "UGX").kind).toBe("MEDUSA_NATIVE")
    expect(() => resolvePaymentProvider(ug, "BANK_TRANSFER", "ZAR")).toThrow(/currency/)
  })

  it("keeps unconfigured regional PSPs disabled", () => {
    for (const policy of ZURIBEANS_PAYMENT_POLICIES) {
      expect(
        policy.providers.find((provider) => provider.kind === "REGIONAL_ADAPTER")?.enabled,
      ).toBe(false)
      expect(() => resolvePaymentProvider(policy, "SELECTED_PSP", policy.currency)).toThrow(
        /No enabled/,
      )
    }
  })
})
