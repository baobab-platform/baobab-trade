export class ThamaniCustomerAuthorizationError extends Error {
  constructor(
    message: string,
    readonly code: "RESOURCE_NOT_OWNED" | "GUEST_RESOURCE_REQUIRES_LOOKUP" | "ORDER_NOT_FOUND",
  ) {
    super(message)
    this.name = "ThamaniCustomerAuthorizationError"
  }
}

export type OwnedResource = { customerId: string | null }

/**
 * A registered customer's session may only reach their own order/cart/etc.
 * A resource with no `customerId` is a guest resource — it is never reachable
 * by session ownership, only by `verifyGuestOrderLookup` below.
 */
export const assertOwnCustomerResource = (
  authenticatedCustomerId: string,
  resource: OwnedResource,
): void => {
  if (resource.customerId === null)
    throw new ThamaniCustomerAuthorizationError(
      "A guest resource cannot be authorised by customer session ownership",
      "GUEST_RESOURCE_REQUIRES_LOOKUP",
    )
  if (resource.customerId !== authenticatedCustomerId)
    throw new ThamaniCustomerAuthorizationError(
      "This customer may not access another customer's resource",
      "RESOURCE_NOT_OWNED",
    )
}

export type GuestOrderLookupInput = { displayId: string; email: string }
export type GuestOrderRecord = { displayId: string; email: string }

const normaliseEmail = (email: string): string => email.trim().toLowerCase()

/**
 * ADR-0017 §102: order number alone is not a sufficient guest-lookup secret
 * — it is sequential/guessable. Requiring the order's own email to match
 * closes that, but only if a wrong email and a wrong order number are
 * indistinguishable to the caller; both mismatches throw the identical
 * ORDER_NOT_FOUND error rather than a more specific one, so a caller cannot
 * use the error to confirm a guessed order number is real. Callers should
 * key `assertWithinRateLimit` (`../../security/rate-limit.ts`) on the caller
 * (e.g. IP) to bound how many attempts this still allows.
 */
export const verifyGuestOrderLookup = (
  input: GuestOrderLookupInput,
  order: GuestOrderRecord,
): void => {
  const matches =
    order.displayId === input.displayId &&
    normaliseEmail(order.email) === normaliseEmail(input.email)
  if (!matches)
    throw new ThamaniCustomerAuthorizationError(
      "No order matches the supplied lookup",
      "ORDER_NOT_FOUND",
    )
}
