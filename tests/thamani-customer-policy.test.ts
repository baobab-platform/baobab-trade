import { describe, expect, it } from "vitest"
import {
  ThamaniConsumerPolicyError,
  assertCheckoutContextResolved,
  assertConsumerCustomer,
  assertKnownConsentPurpose,
  assertNoUnapprovedFields,
  assertValidRegistration,
  hasConsent,
  isPhoneRequiredForMarket,
  recordConsent,
  resolveCheckoutMode,
  toAnalyticsSafeProjection,
  toLogSafeProjection,
} from "../src/baobab/thamani/customer/policy"
import type {
  RegistrationInput,
  ThamaniCheckoutContext,
} from "../src/baobab/thamani/customer/types"

const validRegistration: RegistrationInput = {
  email: "amina@example.com",
  firstName: "Amina",
  lastName: "Nakato",
  phone: "+256700000000",
  marketingConsent: false,
}

const fullContext: ThamaniCheckoutContext = {
  marketKey: "thamani_ug",
  currencyCode: "ugx",
  legalSellerCanonicalId: "THAMANI-UG",
  taxContextResolved: true,
  availablePaymentProviderIds: ["pp_system_default"],
  availableFulfilmentOptionIds: ["manual_manual"],
}

describe("Thamani B2C consumer registration policy", () => {
  it("accepts a minimal, valid registration", () => {
    expect(assertValidRegistration(validRegistration, "thamani_ug")).toBe(validRegistration)
  })

  it("rejects an unapproved extra field (data minimisation)", () => {
    expect(() =>
      assertNoUnapprovedFields({ ...validRegistration, nationalIdNumber: "CM12345" }),
    ).toThrow(ThamaniConsumerPolicyError)
  })

  it("requires a valid email address", () => {
    expect(() =>
      assertValidRegistration({ ...validRegistration, email: "not-an-email" }, "thamani_ug"),
    ).toThrow("valid email")
  })

  it("requires first and last name", () => {
    expect(() =>
      assertValidRegistration({ ...validRegistration, firstName: "  " }, "thamani_ug"),
    ).toThrow("name")
  })

  it("requires a phone number for both launch Markets", () => {
    expect(isPhoneRequiredForMarket("thamani_ug")).toBe(true)
    expect(isPhoneRequiredForMarket("thamani_za")).toBe(true)
    expect(() =>
      assertValidRegistration({ ...validRegistration, phone: undefined }, "thamani_ug"),
    ).toThrow("phone number")
  })

  it("rejects an unknown market key", () => {
    expect(() => assertValidRegistration(validRegistration, "thamani_ke")).toThrow(
      "Unknown Thamani market",
    )
  })
})

describe("Thamani checkout mode and B2C isolation from B2B", () => {
  it("resolves guest vs registered purely from customerId presence", () => {
    expect(resolveCheckoutMode(null)).toBe("GUEST")
    expect(resolveCheckoutMode("cus_123")).toBe("REGISTERED")
  })

  it("rejects a customer record carrying B2B Organisation membership", () => {
    expect(() => assertConsumerCustomer({ customerId: "cus_1" })).not.toThrow()
    expect(() => assertConsumerCustomer({ customerId: "cus_1", organisationId: "org_1" })).toThrow(
      ThamaniConsumerPolicyError,
    )
    expect(() => assertConsumerCustomer({ customerId: "cus_1", membershipId: "mem_1" })).toThrow(
      "B2B Organisation membership",
    )
  })
})

describe("Thamani checkout Commerce Context resolution", () => {
  it("accepts a fully resolved context for both guest and registered checkout", () => {
    expect(() => assertCheckoutContextResolved(fullContext)).not.toThrow()
  })

  it("fails closed when any context field is missing, independent of auth state", () => {
    expect(() =>
      assertCheckoutContextResolved({ ...fullContext, taxContextResolved: false }),
    ).toThrow("taxContextResolved")
    expect(() =>
      assertCheckoutContextResolved({ ...fullContext, availablePaymentProviderIds: [] }),
    ).toThrow("availablePaymentProviderIds")
    expect(() =>
      assertCheckoutContextResolved({ ...fullContext, availableFulfilmentOptionIds: [] }),
    ).toThrow("availableFulfilmentOptionIds")
  })
})

describe("Thamani consent tracking", () => {
  it("upserts consent per purpose without duplicating records", () => {
    let consents = recordConsent([], "MARKETING", true, "2026-09-08T00:00:00Z")
    expect(hasConsent(consents, "MARKETING")).toBe(true)
    consents = recordConsent(consents, "MARKETING", false, "2026-09-09T00:00:00Z")
    expect(consents).toHaveLength(1)
    expect(hasConsent(consents, "MARKETING")).toBe(false)
  })

  it("rejects an unknown consent purpose", () => {
    expect(() => assertKnownConsentPurpose("LOYALTY")).toThrow(ThamaniConsumerPolicyError)
  })
})

describe("Thamani privacy-safe projections", () => {
  const customer = {
    customerId: "cus_1",
    marketKey: "thamani_ug",
    checkoutMode: "REGISTERED" as const,
    email: "amina@example.com",
  }

  it("masks the email address for logs but keeps operational fields", () => {
    const projected = toLogSafeProjection(customer)
    expect(projected.email).not.toBe(customer.email)
    expect(projected.email).toMatch(/^a\*+@example\.com$/)
    expect(projected.customerId).toBe(customer.customerId)
  })

  it("strips every identifying field for analytics", () => {
    const projected = toAnalyticsSafeProjection(customer)
    expect(projected).toEqual({ marketKey: "thamani_ug", checkoutMode: "REGISTERED" })
    expect(projected).not.toHaveProperty("email")
    expect(projected).not.toHaveProperty("customerId")
  })
})
