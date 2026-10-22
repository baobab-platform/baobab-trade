import type { B2BRole, BuyerContext, PurchaseAuthority, PurchaseDecision } from "./types"

export class B2BAuthorizationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INACTIVE_MEMBERSHIP"
      | "ORGANISATION_MISMATCH"
      | "ROLE_REQUIRED"
      | "PO_NUMBER_REQUIRED"
      | "SPEND_POLICY_NOT_CONFIGURED"
      | "SPEND_LIMIT_EXCEEDED"
      | "APPROVAL_AUTHORITY_NOT_CONFIGURED"
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

/**
 * ADR-SHARED-042 section 14, CAA-05 ruling: the absence of a limit is never
 * permission. A null spend limit means no demonstrated spending authority, and
 * a purchase above the limit escalates only where an approval threshold is
 * configured. buyer-operation-policy.ts is the full evaluator.
 */
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

  if (authority.spendLimitMinor === null || authority.spendLimitMinor <= 0) {
    throw new B2BAuthorizationError(
      "No spend authority is configured for this purchase",
      "SPEND_POLICY_NOT_CONFIGURED",
    )
  }
  if (amountMinor > authority.spendLimitMinor) {
    if (authority.approvalThresholdMinor === null) {
      throw new B2BAuthorizationError(
        "Purchase amount exceeds the buyer's spend limit",
        "SPEND_LIMIT_EXCEEDED",
      )
    }
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
  // A missing approver limit is never unlimited approval authority (CAA-05 ruling).
  if (approverLimitMinor === null || approverLimitMinor <= 0) {
    throw new B2BAuthorizationError(
      "No approval authority is configured for this purchase",
      "APPROVAL_AUTHORITY_NOT_CONFIGURED",
    )
  }
  if (amountMinor > approverLimitMinor) {
    throw new B2BAuthorizationError(
      "Purchase amount exceeds the buyer's approval authority",
      "APPROVAL_LIMIT_EXCEEDED",
    )
  }
}
