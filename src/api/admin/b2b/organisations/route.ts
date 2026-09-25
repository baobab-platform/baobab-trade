// Gate ZB-04 — ops queue of buyer organisations (filter by status).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"

const STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"] as const
type OrgStatus = (typeof STATUSES)[number]

const isOrgStatus = (value: unknown): value is OrgStatus =>
  typeof value === "string" && (STATUSES as readonly string[]).includes(value)

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const statusParam = req.query.status
  const filters: Record<string, unknown> = {}
  if (statusParam !== undefined) {
    if (!isOrgStatus(statusParam)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `status must be one of ${STATUSES.join(", ")}`,
      )
    }
    filters.status = statusParam
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const organisations = await b2b.listB2BOrganisations(filters)

  res.status(200).json({
    organisations: organisations.map((o) => ({
      id: o.id,
      legal_name: o.legal_name,
      trading_name: o.trading_name,
      registration_number: o.registration_number,
      status: o.status,
      tenant_id: o.tenant_id,
      default_market_key: o.default_market_key,
      canonical_organisation_id: o.canonical_organisation_id,
      created_at: o.created_at,
      updated_at: o.updated_at,
    })),
  })
}
