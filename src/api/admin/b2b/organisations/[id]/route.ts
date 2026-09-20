// Gate ZB-04 — admin detail for a buyer organisation (review queue drill-down).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const organisation = await b2b.retrieveB2BOrganisation(req.params.id)

  const memberships = await b2b.listBuyerMemberships({
    organisation_id: organisation.id,
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
    organisation: {
      id: organisation.id,
      legal_name: organisation.legal_name,
      trading_name: organisation.trading_name,
      registration_number: organisation.registration_number,
      status: organisation.status,
      tenant_id: organisation.tenant_id,
      default_market_key: organisation.default_market_key,
      canonical_organisation_id: organisation.canonical_organisation_id,
      erp_business_partner_id: organisation.erp_business_partner_id,
      created_at: organisation.created_at,
      updated_at: organisation.updated_at,
    },
    memberships: memberships.map((m) => ({
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
