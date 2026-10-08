import { describe, expect, it } from "vitest"
import {
  anonymiseConsumerCustomer,
  ThamaniAnonymisationBlockedError,
} from "../src/baobab/thamani/customer"

describe("Gate 19 Thamani customer anonymisation", () => {
  const eligible = { customerId: "customer-1", hasOpenOrder: false, hasPendingPayment: false }

  it("replaces every identifying field but keeps a stable customerId", () => {
    const anonymised = anonymiseConsumerCustomer(eligible)
    expect(anonymised.customerId).toBe("customer-1")
    expect(anonymised.email).toContain("customer-1")
    expect(anonymised.email).not.toContain("@example.com")
    expect(anonymised.phone).toBeNull()
    expect(anonymised.firstName).not.toBe("")
  })

  it("refuses to anonymise a customer with a still-open order", () => {
    expect(() => anonymiseConsumerCustomer({ ...eligible, hasOpenOrder: true })).toThrow(
      ThamaniAnonymisationBlockedError,
    )
    expect(() => anonymiseConsumerCustomer({ ...eligible, hasOpenOrder: true })).toThrow(
      /still-open order/,
    )
  })

  it("refuses to anonymise a customer with a pending payment", () =>
    expect(() => anonymiseConsumerCustomer({ ...eligible, hasPendingPayment: true })).toThrow(
      /pending payment/,
    ))
})
