/**
 * Thamani is strictly B2C: a consumer is a Principal behind a Medusa
 * Customer, never a member of a B2B Organisation (contrast
 * `src/baobab/b2b/types.ts` `BuyerContext`, which requires
 * `organisationId`/`membershipId`/`membershipStatus`). Keep this type
 * B2B-organisation-free on purpose — see `assertConsumerCustomer` in
 * `./policy.ts`, which fails closed if a B2B-shaped record is ever passed in
 * by mistake.
 */
export type CheckoutMode = "GUEST" | "REGISTERED"

export const CONSENT_PURPOSES = ["MARKETING", "ANALYTICS"] as const
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export type ConsentRecord = {
  purpose: ConsentPurpose
  granted: boolean
  recordedAt: string
}

/**
 * The minimal registration fields a Thamani consumer may be asked for
 * (spec §13). `phone` is conditionally required by `isPhoneRequiredForMarket`
 * (both launch Markets require it today, for courier/mobile-money delivery
 * coordination) rather than always mandatory, so it is optional on the
 * input type and validated separately.
 */
export type RegistrationInput = {
  email: string
  firstName: string
  lastName: string
  phone?: string
  marketingConsent: boolean
  preferredMarketKey?: string
}

export const REGISTRATION_FIELDS: readonly (keyof RegistrationInput)[] = [
  "email",
  "firstName",
  "lastName",
  "phone",
  "marketingConsent",
  "preferredMarketKey",
]

export type ThamaniConsumerCustomer = {
  customerId: string | null
  marketKey: string
  checkoutMode: CheckoutMode
  consents: readonly ConsentRecord[]
  email: string
  firstName?: string
  lastName?: string
  phone?: string
}

/**
 * Everything a checkout (guest or registered) must resolve before it may
 * proceed, independent of authentication state (spec §12: "Do not confuse
 * authentication state with Commerce Context").
 */
export type ThamaniCheckoutContext = {
  marketKey: string
  currencyCode: string
  legalSellerCanonicalId: string
  taxContextResolved: boolean
  availablePaymentProviderIds: readonly string[]
  availableFulfilmentOptionIds: readonly string[]
}
