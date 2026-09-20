export const BUYER_APPLICATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "INFORMATION_REQUIRED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
] as const

export type BuyerApplicationStatus = (typeof BUYER_APPLICATION_STATUSES)[number]

const TRANSITIONS: Record<BuyerApplicationStatus, readonly BuyerApplicationStatus[]> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["INFORMATION_REQUIRED", "UNDER_REVIEW", "WITHDRAWN"],
  INFORMATION_REQUIRED: ["SUBMITTED", "WITHDRAWN"],
  UNDER_REVIEW: ["INFORMATION_REQUIRED", "APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
  WITHDRAWN: [],
}

export class BuyerOnboardingPolicyError extends Error {
  constructor(
    readonly code:
      | "INVALID_TRANSITION"
      | "MISSING_DECISION_REFERENCE"
      | "MISSING_CANONICAL_LINK"
      | "TENANT_NOT_CONFIGURED",
    message: string,
  ) {
    super(message)
    this.name = "BuyerOnboardingPolicyError"
  }
}

export const assertBuyerApplicationTransition = (
  current: BuyerApplicationStatus,
  next: BuyerApplicationStatus,
  evidence: { decisionReference?: string | null; canonicalOrganisationId?: string | null } = {},
): void => {
  if (!TRANSITIONS[current].includes(next)) {
    throw new BuyerOnboardingPolicyError(
      "INVALID_TRANSITION",
      `cannot transition buyer application from ${current} to ${next}`,
    )
  }
  if ((next === "APPROVED" || next === "REJECTED") && !evidence.decisionReference?.trim()) {
    throw new BuyerOnboardingPolicyError(
      "MISSING_DECISION_REFERENCE",
      "a terminal admission decision requires an immutable decision reference",
    )
  }
  if (next === "APPROVED" && !evidence.canonicalOrganisationId?.trim()) {
    throw new BuyerOnboardingPolicyError(
      "MISSING_CANONICAL_LINK",
      "approval requires a Control Plane-verified canonical organisation link",
    )
  }
}

export const resolveBuyerTenantId = (environment: NodeJS.ProcessEnv = process.env): string => {
  const tenantId = environment.BAOBAB_ZURIBEANS_TENANT_ID?.trim()
  if (!tenantId) {
    throw new BuyerOnboardingPolicyError(
      "TENANT_NOT_CONFIGURED",
      "BAOBAB_ZURIBEANS_TENANT_ID must be configured; tenant identity is never accepted from a buyer request",
    )
  }
  return tenantId
}
