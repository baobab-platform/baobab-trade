// Gate ZB-04 — Buyer Onboarding (status read).
// Returns organisations the authenticated customer is a member of, with
// membership status. Used by the ZuriBeans account shell to show review
// state without treating login as trading approval.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const memberships = await b2b.listBuyerMemberships({
    customer_id: customerId,
  })

  if (memberships.length === 0) {
    res.status(200).json({ organisations: [] })
    return
  }

  const organisationIds = [...new Set(memberships.map((m) => m.organisation_id))]
  const organisations = await b2b.listB2BOrganisations({
    id: organisationIds,
  })
  const orgById = new Map(organisations.map((o) => [o.id, o]))

  res.status(200).json({
    organisations: memberships.map((membership) => {
      const organisation = orgById.get(membership.organisation_id)
      return {
        organisation: organisation
          ? {
              id: organisation.id,
              legal_name: organisation.legal_name,
              trading_name: organisation.trading_name,
              registration_number: organisation.registration_number,
              status: organisation.status,
              tenant_id: organisation.tenant_id,
              default_market_key: organisation.default_market_key,
              canonical_organisation_id: organisation.canonical_organisation_id,
            }
          : null,
        membership: {
          id: membership.id,
          status: membership.status,
          customer_id: membership.customer_id,
        },
      }
    }),
  })
}
