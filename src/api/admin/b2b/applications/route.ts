import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { buyerApplicationView } from "../../../../baobab/b2b/application-view"
import {
  BUYER_APPLICATION_STATUSES,
  type BuyerApplicationStatus,
  resolveBuyerTenantId,
} from "../../../../baobab/b2b/onboarding-policy"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"

const isApplicationStatus = (value: unknown): value is BuyerApplicationStatus =>
  typeof value === "string" &&
  (BUYER_APPLICATION_STATUSES as readonly string[]).includes(value)

const boundedInteger = (
  value: unknown,
  fallback: number,
  maximum: number,
  name: string,
): number => {
  if (value === undefined) return fallback
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} must be a non-negative integer`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${name} exceeds its maximum`)
  }
  return parsed
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const status = req.query.status
  if (status !== undefined && !isApplicationStatus(status)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `status must be one of ${BUYER_APPLICATION_STATUSES.join(", ")}`,
    )
  }

  const limit = boundedInteger(req.query.limit, 50, 100, "limit")
  const offset = boundedInteger(req.query.offset, 0, 10_000, "offset")
  const tenantId = resolveBuyerTenantId()
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const filters: Record<string, unknown> = { tenant_id: tenantId }
  if (status) filters.status = status

  const applications = await b2b.listBuyerApplications(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })

  res.status(200).json({
    applications: applications.map((application) =>
      buyerApplicationView(application as unknown as Record<string, unknown>),
    ),
    limit,
    offset,
  })
}
