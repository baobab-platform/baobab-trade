import type B2BModuleService from "../../modules/b2b/service"
import { B2B_ROLES, type BuyerContext, type B2BRole, type MembershipStatus } from "./types"

type MembershipRecord = Awaited<ReturnType<B2BModuleService["listBuyerMemberships"]>>[number]
type RoleRecord = Awaited<ReturnType<B2BModuleService["listBuyerRoles"]>>[number]

/**
 * Local Medusa membership dates are start-inclusive and end-exclusive. An
 * invalid or reversed interval cannot establish a current buyer relationship.
 * This is a legacy native read guard, NOT canonical IAM/CP authorisation.
 */
const inEffect = (
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  now: number,
): boolean => {
  const boundary = (value: Date | string | null | undefined, fallback: number): number => {
    if (value == null) return fallback
    return value instanceof Date ? value.getTime() : Date.parse(value)
  }
  const from = boundary(start, -Infinity)
  const until = boundary(end, Infinity)
  return !Number.isNaN(from) && !Number.isNaN(until) && from < until && from <= now && now < until
}

/**
 * Resolve one legacy Medusa customer to its native B2B membership. This
 * response is not a canonical buyer Principal or purchase decision: the new
 * IAM/BFF/CP route resolves those independently. Null denotes a missing,
 * ambiguous, invalid or not-current native relationship. Non-ACTIVE statuses
 * remain visible to the local policy so it can refuse them explicitly.
 */
export async function resolveBuyerContext(
  b2b: B2BModuleService,
  organisationId: string,
  customerId: string,
): Promise<BuyerContext | null> {
  const memberships: MembershipRecord[] = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
    customer_id: customerId,
  })
  // Never choose the first of duplicate memberships. The database should
  // enforce uniqueness, but stale/corrupt source responses also fail closed.
  if (memberships.length !== 1) return null
  const membership = memberships[0]
  // Medusa 2.21 permits null on historical identifiers. An unbound identity,
  // incorrect row owner or out-of-effect ACTIVE membership grants nothing.
  if (
    membership.organisation_id !== organisationId ||
    membership.customer_id !== customerId ||
    !membership.principal_id ||
    !membership.customer_id ||
    (membership.status === "ACTIVE" &&
      !inEffect(membership.effective_from, membership.effective_until, Date.now()))
  ) {
    return null
  }
  const roles: RoleRecord[] = await b2b.listBuyerRoles({ membership_id: membership.id })
  return {
    principalId: membership.principal_id,
    customerId: membership.customer_id,
    organisationId: membership.organisation_id,
    membershipId: membership.id,
    membershipStatus: membership.status as MembershipStatus,
    // Never promote an unknown role to authority or trust unscoped role rows.
    roles: roles
      .filter((record) => record.membership_id === membership.id)
      .map((record) => record.role as B2BRole)
      .filter((role) => (B2B_ROLES as readonly string[]).includes(role)),
  }
}
