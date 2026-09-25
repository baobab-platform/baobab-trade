// Gate ZB-04 — staff tax registration verification (zuribeans-tax architecture).
// Membership alone grants no tax treatment; VERIFIED is staff-attested only.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

type StatusBody = {
  status?: unknown
}

type TaxStatus = "PENDING" | "VERIFIED" | "REJECTED" | "EXPIRED"

const ALLOWED: Record<TaxStatus, readonly TaxStatus[]> = {
  PENDING: ["VERIFIED", "REJECTED"],
  VERIFIED: ["EXPIRED", "REJECTED"],
  REJECTED: ["PENDING"],
  EXPIRED: ["PENDING"],
}

const isTaxStatus = (value: unknown): value is TaxStatus =>
  value === "PENDING" ||
  value === "VERIFIED" ||
  value === "REJECTED" ||
  value === "EXPIRED"

export const POST = async (req: AuthenticatedMedusaRequest<StatusBody>, res: MedusaResponse) => {
  const nextStatus = req.body?.status
  if (!isTaxStatus(nextStatus)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "status must be PENDING, VERIFIED, REJECTED, or EXPIRED",
    )
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const registration = await b2b.retrieveTaxRegistration(req.params.id)
  const current = registration.status as TaxStatus

  if (!ALLOWED[current].includes(nextStatus)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `cannot transition tax registration from ${current} to ${nextStatus}`,
    )
  }

  const patch: Record<string, unknown> = { status: nextStatus }
  if (nextStatus === "VERIFIED") {
    patch.verified_at = new Date()
  }
  if (nextStatus === "PENDING" || nextStatus === "REJECTED") {
    patch.verified_at = null
  }

  const updated = await b2b.updateTaxRegistrations(req.params.id, patch)

  res.status(200).json({
    id: updated.id,
    status: updated.status,
    previous_status: current,
    verified_at: updated.verified_at,
  })
}
