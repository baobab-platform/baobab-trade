import { describe, expect, it } from "vitest"
import { assertNoPersonalData } from "../src/baobab/security"

describe("Gate 19 PII guard", () => {
  it("rejects a top-level personal-data field", () =>
    expect(() => assertNoPersonalData({ email: "consumer@example.com" })).toThrow(
      /PERSONAL_DATA_FIELD:data\.email/,
    ))

  it("rejects a personal-data field nested arbitrarily deep, including inside arrays", () =>
    expect(() =>
      assertNoPersonalData({ order: { lines: [{ shipping: { address_1: "1 Main St" } }] } }),
    ).toThrow(/PERSONAL_DATA_FIELD/))

  it("catches common variants: phone, names, address lines, snake_case and camelCase", () => {
    for (const candidate of [
      { phone_number: "+256700000000" },
      { firstName: "Amara" },
      { last_name: "Okello" },
      { address_2: "Suite 4" },
      { dateOfBirth: "1990-01-01" },
    ]) {
      expect(() => assertNoPersonalData(candidate)).toThrow(/PERSONAL_DATA_FIELD/)
    }
  })

  it("never flags commerce-reference fields that merely resemble the pattern loosely", () =>
    expect(() =>
      assertNoPersonalData({
        orderId: "order_1",
        marketKey: "thamani_ug",
        amountMinor: 5000,
        currency: "UGX",
        correlationId: "corr-19",
      }),
    ).not.toThrow())
})
