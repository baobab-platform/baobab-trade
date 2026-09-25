// Gate ZB-04 — operational status transitions for admitted buyer organisations.
// Initial activation is deliberately excluded: approval must pass through the
// application decision flow with immutable decision and canonical-link evidence.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../../modules/b2b"
import type B2BModuleService from "../../../../../../modules/b2b/service"

type StatusBody = {
  status?: unknown
  reason?: unknown
}

type OrgStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "CLOSED"

const ALLOWED: Record<OrgStatus, readonly OrgStatus[]> = {
  PENDING: ["CLOSED"],
  ACTIVE: ["SUSPENDED", "CLOSED"],
  SUSPENDED: ["ACTIVE", "CLOSED"],
  CLOSED: [],
}

const isOrgStatus = (value: unknown): value is OrgStatus =>
  value === "PENDING" || value === "ACTIVE" || value === "SUSPENDED" || value === "CLOSED"

export const POST = async (req: AuthenticatedMedusaRequest<StatusBody>, res: MedusaResponse) => {
  const nextStatus = req.body?.status
  if (!isOrgStatus(nextStatus) || nextStatus === "PENDING") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "status must be ACTIVE, SUSPENDED, or CLOSED",
    )
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : ""
  if (!reason) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "reason is required for an operational status transition",
    )
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const organisation = await b2b.retrieveB2BOrganisation(req.params.id)
  const current = organisation.status as OrgStatus

  if (!ALLOWED[current].includes(nextStatus)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      current === "PENDING" && nextStatus === "ACTIVE"
        ? "initial activation requires the governed buyer-application decision flow"
        : `cannot transition organisation from ${current} to ${nextStatus}`,
    )
  }

  const updated = await b2b.updateB2BOrganisations(req.params.id, {
    status: nextStatus,
  })

  res.status(200).json({
    id: updated.id,
    status: updated.status,
    previous_status: current,
    reason,
  })
}
