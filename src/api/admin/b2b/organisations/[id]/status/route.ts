// Gate ZB-04 — staff status transitions for buyer organisations.
// PENDING → ACTIVE (approve) | CLOSED (reject)
// ACTIVE → SUSPENDED | CLOSED
// SUSPENDED → ACTIVE | CLOSED
// CLOSED is terminal for this increment.
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
  PENDING: ["ACTIVE", "CLOSED"],
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

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const organisation = await b2b.retrieveB2BOrganisation(req.params.id)
  const current = organisation.status as OrgStatus

  if (!ALLOWED[current].includes(nextStatus)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `cannot transition organisation from ${current} to ${nextStatus}`,
    )
  }

  const updated = await b2b.updateB2BOrganisations(req.params.id, {
    status: nextStatus,
  })

  res.status(200).json({
    id: updated.id,
    status: updated.status,
    previous_status: current,
    reason: typeof req.body?.reason === "string" ? req.body.reason : null,
  })
}
