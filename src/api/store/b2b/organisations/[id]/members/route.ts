// Gate ZB-04 — team roster for a buyer organisation.
// Caller must hold a membership in the organisation; returns memberships +
// roles. Does not expose other organisations' members.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }

  const organisationId = req.params.id
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)

  const callerMemberships = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
    customer_id: customerId,
  })
  if (callerMemberships.length === 0) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "the authenticated buyer has no membership in this organisation",
    )
  }

  const memberships = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
  })

  const membershipIds = memberships.map((m) => m.id)
  const roles =
    membershipIds.length > 0
      ? await b2b.listBuyerRoles({ membership_id: membershipIds })
      : []

  const rolesByMembership = new Map<string, string[]>()
  for (const role of roles) {
    const list = rolesByMembership.get(role.membership_id) ?? []
    list.push(role.role)
    rolesByMembership.set(role.membership_id, list)
  }

  res.status(200).json({
    organisation_id: organisationId,
    members: memberships.map((m) => ({
      id: m.id,
      customer_id: m.customer_id,
      principal_id: m.principal_id,
      status: m.status,
      invited_email: m.invited_email,
      invitation_accepted_at: m.invitation_accepted_at,
      roles: rolesByMembership.get(m.id) ?? [],
    })),
  })
}
