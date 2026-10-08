import { THAMANI_LAUNCH_MARKETS } from "../../market/thamani-market-config"
import {
  CONSENT_PURPOSES,
  REGISTRATION_FIELDS,
  type CheckoutMode,
  type ConsentPurpose,
  type ConsentRecord,
  type RegistrationInput,
  type ThamaniCheckoutContext,
} from "./types"

export class ThamaniConsumerPolicyError extends Error {
  constructor(
    message: string,
    readonly code:
      | "MISSING_REQUIRED_FIELD"
      | "PHONE_REQUIRED_FOR_MARKET"
      | "UNSUPPORTED_FIELD_COLLECTED"
      | "UNKNOWN_MARKET"
      | "UNKNOWN_CONSENT_PURPOSE"
      | "CONTEXT_INCOMPLETE"
      | "B2B_MEMBERSHIP_NOT_PERMITTED",
  ) {
    super(message)
    this.name = "ThamaniConsumerPolicyError"
  }
}

const THAMANI_MARKET_KEYS = new Set(THAMANI_LAUNCH_MARKETS.map((market) => market.marketKey))

/** Both launch Markets need a phone number to coordinate courier and mobile-money delivery. */
export const isPhoneRequiredForMarket = (marketKey: string): boolean =>
  THAMANI_MARKET_KEYS.has(marketKey)

/**
 * Data minimisation guard (spec §13): a registration payload may only ever
 * carry the governed minimal field set. This is deliberately stricter than
 * "ignore extra fields" — an unexpected key is a signal that something
 * upstream is collecting identity data Thamani never approved.
 */
export function assertNoUnapprovedFields(candidate: Record<string, unknown>): void {
  for (const key of Object.keys(candidate)) {
    if (!REGISTRATION_FIELDS.includes(key as keyof RegistrationInput)) {
      throw new ThamaniConsumerPolicyError(
        `Field "${key}" is not part of the approved Thamani registration set`,
        "UNSUPPORTED_FIELD_COLLECTED",
      )
    }
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function assertValidRegistration(
  input: RegistrationInput,
  marketKey: string,
): RegistrationInput {
  assertNoUnapprovedFields(input)

  if (!THAMANI_MARKET_KEYS.has(marketKey)) {
    throw new ThamaniConsumerPolicyError(
      `Unknown Thamani market key "${marketKey}"`,
      "UNKNOWN_MARKET",
    )
  }
  if (!EMAIL_PATTERN.test(input.email.trim())) {
    throw new ThamaniConsumerPolicyError(
      "A valid email address is required",
      "MISSING_REQUIRED_FIELD",
    )
  }
  if (!input.firstName.trim() || !input.lastName.trim()) {
    throw new ThamaniConsumerPolicyError(
      "First and last name are required",
      "MISSING_REQUIRED_FIELD",
    )
  }
  if (isPhoneRequiredForMarket(marketKey) && !input.phone?.trim()) {
    throw new ThamaniConsumerPolicyError(
      `A phone number is required for market "${marketKey}"`,
      "PHONE_REQUIRED_FOR_MARKET",
    )
  }

  return input
}

/** Guest checkout has no `customerId`; a registered checkout always does. */
export const resolveCheckoutMode = (customerId: string | null): CheckoutMode =>
  customerId ? "REGISTERED" : "GUEST"

/**
 * A consumer is never a B2B Organisation member (spec §11). Fails closed if
 * a caller accidentally passes a B2B `BuyerContext`-shaped record — the
 * presence of `organisationId` or `membershipId` on a consumer record is
 * itself the bug this guards against.
 */
export function assertConsumerCustomer(candidate: Record<string, unknown>): void {
  if ("organisationId" in candidate || "membershipId" in candidate) {
    throw new ThamaniConsumerPolicyError(
      "Thamani consumers must not carry B2B Organisation membership",
      "B2B_MEMBERSHIP_NOT_PERMITTED",
    )
  }
}

/**
 * Guest and registered checkout resolve the identical Commerce Context
 * (spec §12): Market, currency, Legal Seller, tax context, payment
 * providers, and fulfilment options must all be present before checkout may
 * proceed, regardless of `checkoutMode`.
 */
export function assertCheckoutContextResolved(context: ThamaniCheckoutContext): void {
  const missing: string[] = []
  if (!context.marketKey.trim()) missing.push("marketKey")
  if (!context.currencyCode.trim()) missing.push("currencyCode")
  if (!context.legalSellerCanonicalId.trim()) missing.push("legalSellerCanonicalId")
  if (!context.taxContextResolved) missing.push("taxContextResolved")
  if (context.availablePaymentProviderIds.length === 0) missing.push("availablePaymentProviderIds")
  if (context.availableFulfilmentOptionIds.length === 0)
    missing.push("availableFulfilmentOptionIds")

  if (missing.length > 0) {
    throw new ThamaniConsumerPolicyError(
      `Checkout Commerce Context is incomplete: missing ${missing.join(", ")}`,
      "CONTEXT_INCOMPLETE",
    )
  }
}

/** Upserts one purpose's consent by recorded time, never duplicating a purpose. */
export function recordConsent(
  existing: readonly ConsentRecord[],
  purpose: ConsentPurpose,
  granted: boolean,
  recordedAt: string,
): ConsentRecord[] {
  const withoutPurpose = existing.filter((record) => record.purpose !== purpose)
  return [...withoutPurpose, { purpose, granted, recordedAt }]
}

export function hasConsent(existing: readonly ConsentRecord[], purpose: ConsentPurpose): boolean {
  return existing.some((record) => record.purpose === purpose && record.granted)
}

export function assertKnownConsentPurpose(purpose: string): asserts purpose is ConsentPurpose {
  if (!CONSENT_PURPOSES.includes(purpose as ConsentPurpose)) {
    throw new ThamaniConsumerPolicyError(
      `Unknown consent purpose "${purpose}"`,
      "UNKNOWN_CONSENT_PURPOSE",
    )
  }
}

const maskEmail = (email: string): string => {
  const [local, domain] = email.split("@")
  if (!domain) return "***"
  const visible = local.slice(0, 1)
  return `${visible}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`
}

/**
 * Log-safe projection (spec §14, §82: restricted log exposure, no PII as
 * metric labels). Email is masked rather than dropped so support/ops tooling
 * can still recognise a repeat contact without storing the raw address in
 * log aggregation.
 */
export function toLogSafeProjection(customer: {
  customerId: string | null
  marketKey: string
  checkoutMode: CheckoutMode
  email: string
}): { customerId: string | null; marketKey: string; checkoutMode: CheckoutMode; email: string } {
  return {
    customerId: customer.customerId,
    marketKey: customer.marketKey,
    checkoutMode: customer.checkoutMode,
    email: maskEmail(customer.email),
  }
}

/**
 * Analytics-safe projection (spec §75: avoid sensitive PII in analytics
 * event properties). No identifying field survives — not even a masked one.
 */
export function toAnalyticsSafeProjection(customer: {
  marketKey: string
  checkoutMode: CheckoutMode
}): { marketKey: string; checkoutMode: CheckoutMode } {
  return { marketKey: customer.marketKey, checkoutMode: customer.checkoutMode }
}
