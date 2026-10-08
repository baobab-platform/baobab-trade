import type { B2BRole, BuyerContext, PurchaseAuthority, PurchaseDecision } from "./types"

export class B2BAuthorizationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INACTIVE_MEMBERSHIP"
      | "ORGANISATION_MISMATCH"
      | "ROLE_REQUIRED"
      | "PO_NUMBER_REQUIRED"
      | "APPROVAL_LIMIT_EXCEEDED",
  ) {
    super(message)
    this.name = "B2BAuthorizationError"
  }
}

export function assertActiveBuyerContext(context: BuyerContext, organisationId: string): void {
  if (context.membershipStatus !== "ACTIVE") {
    throw new B2BAuthorizationError(
      "Active organisation membership is required",
      "INACTIVE_MEMBERSHIP",
    )
  }
  if (context.organisationId !== organisationId) {
    throw new B2BAuthorizationError(
      "Buyer membership does not belong to the requested organisation",
      "ORGANISATION_MISMATCH",
    )
  }
}

export function assertRole(context: BuyerContext, permitted: readonly B2BRole[]): void {
  if (!context.roles.some((role) => permitted.includes(role))) {
    throw new B2BAuthorizationError("Buyer role does not permit this operation", "ROLE_REQUIRED")
  }
}

export function decidePurchase(
  context: BuyerContext,
  authority: PurchaseAuthority,
  amountMinor: number,
  customerPoNumber?: string,
): PurchaseDecision {
  assertRole(context, ["BUYER", "SENIOR_BUYER", "PROCUREMENT_MANAGER", "ACCOUNT_ADMIN"])

  if (authority.purchaseOrderRequired && !customerPoNumber?.trim()) {
    throw new B2BAuthorizationError(
      "A customer purchase-order number is required",
      "PO_NUMBER_REQUIRED",
    )
  }

  if (authority.spendLimitMinor !== null && amountMinor > authority.spendLimitMinor) {
    return { outcome: "REQUIRE_APPROVAL", reason: "SPEND_LIMIT" }
  }
  if (authority.approvalThresholdMinor !== null && amountMinor > authority.approvalThresholdMinor) {
    return { outcome: "REQUIRE_APPROVAL", reason: "THRESHOLD" }
  }
  return { outcome: "PLACE_ORDER" }
}

export function assertApprovalAuthority(
  context: BuyerContext,
  organisationId: string,
  amountMinor: number,
  approverLimitMinor: number | null,
): void {
  assertActiveBuyerContext(context, organisationId)
  assertRole(context, ["APPROVER", "PROCUREMENT_MANAGER", "ACCOUNT_ADMIN"])
  if (approverLimitMinor !== null && amountMinor > approverLimitMinor) {
    throw new B2BAuthorizationError(
      "Purchase amount exceeds the buyer's approval authority",
      "APPROVAL_LIMIT_EXCEEDED",
    )
  }
}
