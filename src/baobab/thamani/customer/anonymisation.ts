/**
 * ADR-0008 §127/§128 and ADR-0017 §70: a deletion request against a consumer
 * who has commerce history is satisfied by anonymisation, not a hard delete
 * — `customerId` must survive so existing orders/ERP projections keep a
 * valid reference, while every identifying field is irrecoverably replaced.
 * Anonymisation is refused outright (not merely deferred) while the customer
 * has a state that still needs their real identity: an open order still
 * needs delivery to a real address, and a pending payment may still need
 * dispute/chargeback contact.
 */
export type AnonymisationEligibility = {
  hasOpenOrder: boolean
  hasPendingPayment: boolean
}

export class ThamaniAnonymisationBlockedError extends Error {
  constructor(readonly code: "OPEN_ORDER" | "PENDING_PAYMENT") {
    super(
      `Anonymisation is blocked by a ${code === "OPEN_ORDER" ? "still-open order" : "pending payment"}`,
    )
    this.name = "ThamaniAnonymisationBlockedError"
  }
}

export const assertAnonymisationEligible = (eligibility: AnonymisationEligibility): void => {
  if (eligibility.hasOpenOrder) throw new ThamaniAnonymisationBlockedError("OPEN_ORDER")
  if (eligibility.hasPendingPayment) throw new ThamaniAnonymisationBlockedError("PENDING_PAYMENT")
}

export type AnonymisableCustomer = AnonymisationEligibility & {
  customerId: string
}

export type AnonymisedCustomer = {
  customerId: string
  email: string
  firstName: string
  lastName: string
  phone: null
  anonymisedAt: string
}

export const anonymiseConsumerCustomer = (customer: AnonymisableCustomer): AnonymisedCustomer => {
  assertAnonymisationEligible(customer)
  return {
    customerId: customer.customerId,
    email: `anon-${customer.customerId}@anonymised.thamani.invalid`,
    firstName: "Anonymised",
    lastName: "Customer",
    phone: null,
    anonymisedAt: new Date().toISOString(),
  }
}
