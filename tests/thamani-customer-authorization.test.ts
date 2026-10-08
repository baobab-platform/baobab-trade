import { describe, expect, it } from "vitest"
import {
  assertOwnCustomerResource,
  verifyGuestOrderLookup,
  ThamaniCustomerAuthorizationError,
} from "../src/baobab/thamani/customer"

describe("Gate 19 Thamani customer authorization", () => {
  it("allows a registered customer to reach their own resource", () =>
    expect(() =>
      assertOwnCustomerResource("customer-1", { customerId: "customer-1" }),
    ).not.toThrow())

  it("blocks cross-customer IDOR with a typed authorization error", () => {
    expect(() => assertOwnCustomerResource("customer-1", { customerId: "customer-2" })).toThrow(
      /another customer's resource/,
    )
    try {
      assertOwnCustomerResource("customer-1", { customerId: "customer-2" })
    } catch (error) {
      expect(error).toBeInstanceOf(ThamaniCustomerAuthorizationError)
      expect((error as ThamaniCustomerAuthorizationError).code).toBe("RESOURCE_NOT_OWNED")
    }
  })

  it("never lets session ownership reach a guest resource", () =>
    expect(() => assertOwnCustomerResource("customer-1", { customerId: null })).toThrow(
      /guest resource/,
    ))

  const order = { displayId: "1042", email: "consumer@example.com" }

  it("verifies a guest order lookup by order number and email together", () =>
    expect(() =>
      verifyGuestOrderLookup({ displayId: "1042", email: "consumer@example.com" }, order),
    ).not.toThrow())

  it("is tolerant of email case/whitespace but not of the wrong email", () => {
    expect(() =>
      verifyGuestOrderLookup({ displayId: "1042", email: " Consumer@Example.com " }, order),
    ).not.toThrow()
    expect(() =>
      verifyGuestOrderLookup({ displayId: "1042", email: "attacker@example.com" }, order),
    ).toThrow(/No order matches/)
  })

  it("gives the identical error for a wrong order number as for a wrong email, so a caller cannot enumerate valid order numbers", () => {
    let wrongOrderNumberError: unknown
    let wrongEmailError: unknown
    try {
      verifyGuestOrderLookup({ displayId: "9999", email: "consumer@example.com" }, order)
    } catch (error) {
      wrongOrderNumberError = error
    }
    try {
      verifyGuestOrderLookup({ displayId: "1042", email: "attacker@example.com" }, order)
    } catch (error) {
      wrongEmailError = error
    }
    expect((wrongOrderNumberError as Error).message).toBe((wrongEmailError as Error).message)
    expect((wrongOrderNumberError as ThamaniCustomerAuthorizationError).code).toBe(
      (wrongEmailError as ThamaniCustomerAuthorizationError).code,
    )
  })
})
