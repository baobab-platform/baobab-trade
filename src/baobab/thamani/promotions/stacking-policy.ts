/**
 * ADR-0012 §34: "Baobab SHALL define deterministic rules governing whether
 * multiple promotions may combine. The chosen policy SHALL be explicit and
 * testable." Medusa's Promotion module has no native stacking/exclusivity
 * concept at all — `updateCartPromotionsWorkflow` will happily add and
 * compute actions for as many simultaneously-applied codes as a caller
 * requests. Thamani's policy — confirmed for Gate 9 — is **exclusive**: at
 * most one Promotion may be active on a cart at a time, the conservative
 * default ADR-0012 recommends where economics are sensitive.
 *
 * This is enforced by Baobab's own policy layer in front of Medusa's
 * workflow, not by anything Medusa does automatically.
 */
export class ThamaniPromotionStackingViolationError extends Error {
  constructor(
    readonly currentlyAppliedCode: string,
    readonly requestedCode: string,
  ) {
    super(
      `Cart already has promotion "${currentlyAppliedCode}" applied — "${requestedCode}" would violate the exclusive stacking policy`,
    )
    this.name = "ThamaniPromotionStackingViolationError"
  }
}

/**
 * Fails closed (throws) rather than allowing a second promotion to stack
 * onto a cart that already has one applied. Re-requesting the same code
 * already on the cart is a no-op, not a violation.
 */
export function assertExclusivePromotionStacking(
  currentlyAppliedCodes: readonly string[],
  requestedCode: string,
): void {
  const conflicting = currentlyAppliedCodes.find((code) => code !== requestedCode)
  if (conflicting) {
    throw new ThamaniPromotionStackingViolationError(conflicting, requestedCode)
  }
}
