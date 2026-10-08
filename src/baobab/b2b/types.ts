export const B2B_ROLES = [
  "BUYER",
  "SENIOR_BUYER",
  "APPROVER",
  "PROCUREMENT_MANAGER",
  "ACCOUNT_ADMIN",
  "VIEWER",
] as const

export type B2BRole = (typeof B2B_ROLES)[number]

export const MEMBERSHIP_STATUSES = ["INVITED", "ACTIVE", "SUSPENDED", "REVOKED"] as const
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]

export type BuyerContext = {
  principalId: string
  customerId: string
  organisationId: string
  membershipId: string
  membershipStatus: MembershipStatus
  roles: B2BRole[]
}

export type PurchaseAuthority = {
  spendLimitMinor: number | null
  approvalThresholdMinor: number | null
  approverLimitMinor: number | null
  purchaseOrderRequired: boolean
}

export type PurchaseDecision =
  | { outcome: "PLACE_ORDER" }
  | { outcome: "REQUIRE_APPROVAL"; reason: "THRESHOLD" | "SPEND_LIMIT" }
