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

  const evidence = await b2b.listBuyerApplicationEvidences(
    { application_id: application.id, tenant_id: tenantId },
    { order: { submitted_at: "ASC" } },
  )
  const evidenceDecisions = await b2b.listBuyerApplicationEvidenceDecisions({
    application_id: application.id,
    tenant_id: tenantId,
  })

  res.status(200).json({
    application: buyerApplicationView(
      application as unknown as Record<string, unknown>,
    ),
    evidence: evidence.map((item) => ({
      id: item.id,
      evidence_type: item.evidence_type,
      canonical_document_id: item.canonical_document_id,
      document_version: item.document_version,
      content_sha256: item.content_sha256,
      media_type: item.media_type,
      size_bytes: item.size_bytes,
      issued_at: item.issued_at,
      expires_at: item.expires_at,
      status: item.status,
      submitted_at: item.submitted_at,
      decision: evidenceDecisions.find((decision) => decision.evidence_id === item.id) ?? null,
    })),
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
