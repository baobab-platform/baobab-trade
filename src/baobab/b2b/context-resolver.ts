import type B2BModuleService from "../../modules/b2b/service"
import type { BuyerContext, B2BRole, MembershipStatus } from "./types"

type MembershipRecord = Awaited<ReturnType<B2BModuleService["listBuyerMemberships"]>>[number]
type RoleRecord = Awaited<ReturnType<B2BModuleService["listBuyerRoles"]>>[number]

// resolveBuyerContext is the composition this module's pure policy layer
// (assertActiveBuyerContext, decidePurchase, ...) always assumed existed but
// never built: given an organisation and an authenticated customer, look up
// that customer's buyer_membership and buyer_role rows and assemble the
// BuyerContext those policy functions take as input. Before this, no code
// path in the repository ever turned raw B2BModuleService rows into a
// BuyerContext -- callers had to construct one by hand (as every existing
// test in tests/b2b-policy.test.ts does).
//
// Returns null when the customer has no membership row for the organisation
// at all (never invited) -- distinct from an INVITED/SUSPENDED/REVOKED
// membership, which resolves to a BuyerContext that
// assertActiveBuyerContext then rejects with a specific, actionable reason.
export async function resolveBuyerContext(
  b2b: B2BModuleService,
  organisationId: string,
  customerId: string,
): Promise<BuyerContext | null> {
  const memberships: MembershipRecord[] = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
    customer_id: customerId,
  })
  if (memberships.length === 0) {
    return null
  }
  const membership = memberships[0]
  const roles: RoleRecord[] = await b2b.listBuyerRoles({ membership_id: membership.id })
  return {
    principalId: membership.principal_id,
    customerId: membership.customer_id,
    organisationId: membership.organisation_id,
    membershipId: membership.id,
    membershipStatus: membership.status as MembershipStatus,
    roles: roles.map((role) => role.role as B2BRole),
  }
}
