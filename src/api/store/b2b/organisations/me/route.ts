// Gate ZB-04 — Buyer Onboarding (status read).
// Returns organisations the authenticated customer is a member of, with
// membership status. Used by the ZuriBeans account shell to show review
// state without treating login as trading approval.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { resolveBuyerTenantId } from "../../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const tenantId = resolveBuyerTenantId()
  const [memberships, applications] = await Promise.all([
    b2b.listBuyerMemberships({ customer_id: customerId }),
    b2b.listBuyerApplications({ tenant_id: tenantId, applicant_customer_id: customerId }),
  ])

  // Never treat a filter result as proof that the customer owns every row.
  const ownedMemberships = memberships.filter((membership) => membership.customer_id === customerId)
  const organisationIds = [...new Set(ownedMemberships.map((m) => m.organisation_id))]
  // Native membership is not a tenant assertion. Scope the organisation read
  // AND check the returned owner, even if a source ignores its filter.
  const organisations =
    organisationIds.length > 0
      ? await b2b.listB2BOrganisations({ id: organisationIds, tenant_id: tenantId })
      : []
  const orgById = new Map(
    organisations.filter((o) => o.tenant_id === tenantId).map((o) => [o.id, o]),
  )

  res.status(200).json({
    applications: applications
      .filter((application) => application.tenant_id === tenantId && application.applicant_customer_id === customerId)
      .map((application) => ({
      id: application.id,
      status: application.status,
      legal_name: application.legal_name,
      trading_name: application.trading_name,
      registration_number: application.registration_number,
      country_of_registration: application.country_of_registration,
      requested_market_keys: application.requested_market_keys,
      submitted_at: application.submitted_at,
      revision: application.revision,
    })),
    organisations: ownedMemberships
      .filter((membership) => orgById.has(membership.organisation_id))
      .map((membership) => {
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
