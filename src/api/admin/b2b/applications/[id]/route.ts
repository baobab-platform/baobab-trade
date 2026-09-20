import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { buyerApplicationView } from "../../../../../baobab/b2b/application-view"
import { resolveBuyerTenantId } from "../../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const tenantId = resolveBuyerTenantId()
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const application = await b2b.retrieveBuyerApplication(req.params.id)

  if (application.tenant_id !== tenantId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "buyer application was not found")
  }

  const reviewActions = await b2b.listBuyerApplicationReviewActions(
    { application_id: application.id, tenant_id: tenantId },
    { order: { application_revision: "ASC" } },
  )

  res.status(200).json({
    application: buyerApplicationView(
      application as unknown as Record<string, unknown>,
    ),
    review_actions: reviewActions.map((action) => ({
      id: action.id,
      from_status: action.from_status,
      to_status: action.to_status,
      reviewer_principal_id: action.reviewer_principal_id,
      reason_code: action.reason_code,
      note: action.note,
      application_revision: action.application_revision,
      action_at: action.action_at,
    })),
  })
}
