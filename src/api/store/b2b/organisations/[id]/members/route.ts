// Gate ZB-04 — team roster and invitation boundary.
// GET is available to active members. POST fails closed until a delivery adapter
// can transmit one-time tokens without returning bearer secrets to the browser.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

type InviteBody = {
  email?: unknown
  role?: unknown
}

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
  if (!callerMemberships.some((membership) => membership.status === "ACTIVE")) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "an active membership in this organisation is required",
    )
  }

  const memberships = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
  })

  const membershipIds = memberships.map((membership) => membership.id)
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
    members: memberships.map((membership) => ({
      id: membership.id,
      customer_id: membership.customer_id,
      principal_id: membership.principal_id,
      status: membership.status,
      invited_email: membership.invited_email,
      invitation_accepted_at: membership.invitation_accepted_at,
      roles: rolesByMembership.get(membership.id) ?? [],
    })),
  })
}

export const POST = async (
  _req: AuthenticatedMedusaRequest<InviteBody>,
  _res: MedusaResponse,
) => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "member invitations are disabled until the secure invitation delivery adapter is configured",
  )
}
