import { createHash } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { buyerApplicationView } from "../../../../../../baobab/b2b/application-view"
import {
  assertBuyerApplicationTransition,
  principalIdFromAuthContext,
  resolveBuyerTenantId,
  type BuyerApplicationStatus,
} from "../../../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../../../modules/b2b"
import type B2BModuleService from "../../../../../../modules/b2b/service"

type ReviewBody = {
  status?: unknown
  reason_code?: unknown
  note?: unknown
  expected_revision?: unknown
}

type ReviewStatus = "INFORMATION_REQUIRED" | "UNDER_REVIEW"

const isReviewStatus = (value: unknown): value is ReviewStatus =>
  value === "INFORMATION_REQUIRED" || value === "UNDER_REVIEW"

const requiredText = (value: unknown, name: string, maximum: number): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} is required`)
  }
  const normalized = value.trim()
  if (normalized.length > maximum) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} is too long`)
  }
  return normalized
}

const reviewActionView = (action: Record<string, unknown>) => ({
  id: action.id,
  from_status: action.from_status,
  to_status: action.to_status,
  reviewer_principal_id: action.reviewer_principal_id,
  reason_code: action.reason_code,
  note: action.note,
  application_revision: action.application_revision,
  action_at: action.action_at,
})

export const POST = async (req: AuthenticatedMedusaRequest<ReviewBody>, res: MedusaResponse) => {
  const reviewerPrincipalId = principalIdFromAuthContext(req.auth_context)
  if (!reviewerPrincipalId) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "canonical staff Principal mapping is required for application review",
    )
  }

  const nextStatus = req.body?.status
  if (!isReviewStatus(nextStatus)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "status must be INFORMATION_REQUIRED or UNDER_REVIEW",
    )
  }

  const reasonCode = requiredText(req.body?.reason_code, "reason_code", 64)
  if (!/^[A-Z][A-Z0-9_]*$/.test(reasonCode)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "reason_code must be an uppercase machine-readable code",
    )
  }
  const note =
    req.body?.note === undefined || req.body.note === null
      ? null
      : requiredText(req.body.note, "note", 2_000)
  const expectedRevision = req.body?.expected_revision
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "expected_revision must be a positive integer",
    )
  }

  const idempotencyKey = req.headers["idempotency-key"]?.toString().trim()
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Idempotency-Key must contain between 16 and 128 characters",
    )
  }

  const tenantId = resolveBuyerTenantId()
  const normalized = {
    application_id: req.params.id,
    status: nextStatus,
    reason_code: reasonCode,
    note,
    expected_revision: Number(expectedRevision),
  }
  const requestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)

  const replay = await b2b.listBuyerApplicationReviewActions({
    tenant_id: tenantId,
    idempotency_key: idempotencyKey,
  })
  if (replay.length > 0) {
    if (replay[0].request_hash !== requestHash) {
      throw new MedusaError(
        MedusaError.Types.DUPLICATE_ERROR,
        "Idempotency-Key was already used for a different review action",
      )
    }
    const replayApplication = await b2b.retrieveBuyerApplication(req.params.id)
    if (replayApplication.tenant_id !== tenantId) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "buyer application was not found")
    }
    res.status(200).json({
      application: buyerApplicationView(
        replayApplication as unknown as Record<string, unknown>,
      ),
      review_action: reviewActionView(
        replay[0] as unknown as Record<string, unknown>,
      ),
    })
    return
  }

  const application = await b2b.retrieveBuyerApplication(req.params.id)
  if (application.tenant_id !== tenantId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "buyer application was not found")
  }
  if (application.revision !== expectedRevision) {
    throw new MedusaError(
      MedusaError.Types.DUPLICATE_ERROR,
      "buyer application changed; reload before reviewing",
    )
  }

  try {
    assertBuyerApplicationTransition(
      application.status as BuyerApplicationStatus,
      nextStatus,
    )
  } catch {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `cannot transition buyer application from ${application.status} to ${nextStatus}`,
    )
  }

  const nextRevision = Number(application.revision) + 1
  const reviewAction = await b2b.createBuyerApplicationReviewActions({
    application_id: application.id,
    tenant_id: tenantId,
    from_status: application.status as "SUBMITTED" | "UNDER_REVIEW",
    to_status: nextStatus,
    reviewer_principal_id: reviewerPrincipalId,
    reason_code: reasonCode,
    note,
    application_revision: nextRevision,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    action_at: new Date(),
  })

  let updated
  try {
    updated = await b2b.updateBuyerApplications(application.id, {
      status: nextStatus,
      revision: nextRevision,
      assigned_reviewer_principal_id: reviewerPrincipalId,
    })
  } catch (error) {
    await b2b.deleteBuyerApplicationReviewActions(reviewAction.id)
    throw error
  }

  res.status(200).json({
    application: buyerApplicationView(updated as unknown as Record<string, unknown>),
    review_action: reviewActionView(
      reviewAction as unknown as Record<string, unknown>,
    ),
  })
}
