// Gate ZB-04 — capability snapshot for the authenticated buyer.
// organisation + team are true only when the customer has an ACTIVE membership
// in an ACTIVE organisation. catalogue / orders / documents remain false until
// later gates publish purchasing and document contracts.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const memberships = await b2b.listBuyerMemberships({
    customer_id: customerId,
    status: "ACTIVE",
  })

  let organisationActive = false
  let organisationId: string | null = null
  let organisationStatus: string | null = null

  if (memberships.length > 0) {
    const organisationIds = [...new Set(memberships.map((m) => m.organisation_id))]
    const organisations = await b2b.listB2BOrganisations({
      id: organisationIds,
    })
    const active = organisations.find((o) => o.status === "ACTIVE")
    if (active) {
      organisationActive = true
      organisationId = active.id
      organisationStatus = active.status
    } else if (organisations[0]) {
      organisationId = organisations[0].id
      organisationStatus = organisations[0].status
    }
  }

  res.status(200).json({
    organisation_id: organisationId,
    organisation_status: organisationStatus,
    capabilities: {
      organisation: organisationActive,
      team: organisationActive,
      catalogue: false,
      orders: false,
      documents: false,
    },
  })
}
