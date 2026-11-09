import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { principalIdFromAuthContext } from "../../../../../../../../baobab/b2b/onboarding-policy"
import { requireLegacyTenantOrganisation } from "../../../../../../../../baobab/b2b/legacy-tenant-scope"
import { B2B_MODULE } from "../../../../../../../../modules/b2b"
import type B2BModuleService from "../../../../../../../../modules/b2b/service"

const activeAdmin = async (b2b: B2BModuleService, organisationId: string, customerId: string) => {
  const memberships = await b2b.listBuyerMemberships({
    organisation_id: organisationId,
    customer_id: customerId,
    status: "ACTIVE",
  })
  if (
    memberships.length !== 1 ||
    memberships[0].organisation_id !== organisationId ||
    memberships[0].customer_id !== customerId ||
    memberships[0].status !== "ACTIVE"
  )
    return false
  const roles = await b2b.listBuyerRoles({ membership_id: memberships[0].id })
  return roles.some(
    (role) => role.membership_id === memberships[0].id && role.role === "ACCOUNT_ADMIN",
  )
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId || !principalIdFromAuthContext(req.auth_context)) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "canonical organisation administrator is required",
    )
  }
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  await requireLegacyTenantOrganisation(b2b, req.params.id)
  if (!(await activeAdmin(b2b, req.params.id, customerId))) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "only an ACCOUNT_ADMIN can revoke invitations",
    )
  }
  const membership = await b2b.retrieveBuyerMembership(req.params.membershipId)
  if (membership.organisation_id !== req.params.id || membership.status !== "INVITED") {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "active invitation was not found")
  }
  const updated = await b2b.updateBuyerMemberships({
    id: membership.id,
    status: "REVOKED",
    invitation_token_hash: null,
    invitation_expires_at: null,
    effective_until: new Date(),
  })
  res.status(200).json({ membership_id: updated.id, status: updated.status })
}
