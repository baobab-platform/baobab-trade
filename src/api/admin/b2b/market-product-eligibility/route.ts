// Gate ZB-06 — market assortment + regulatory eligibility (ADR-0024 / ADR-0030).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import type {
  CommercialAssortmentStatus,
  RegulatoryEligibility,
} from "../../../../baobab/b2b/product-assortment-policy"
import { isMarketAssortmentSellable } from "../../../../baobab/b2b/product-assortment-policy"

type Body = {
  product_id?: unknown
  market_key?: unknown
  status?: unknown
  regulatory_eligibility?: unknown
  policy_reference?: unknown
  effective_from?: unknown
  effective_until?: unknown
}

const STATUSES: CommercialAssortmentStatus[] = ["ACTIVE", "SUSPENDED", "WITHDRAWN"]
const REGS: RegulatoryEligibility[] = [
  "NOT_EVALUATED",
  "PENDING",
  "ELIGIBLE",
  "ELIGIBLE_WITH_CONDITIONS",
  "REVIEW_REQUIRED",
  "INELIGIBLE",
  "SUSPENDED",
  "EXPIRED",
  "ERROR",
]

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${field} is required`)
  }
  return value.trim()
}

export const POST = async (req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) => {
  const productId = requireString(req.body?.product_id, "product_id")
  const marketKey = requireString(req.body?.market_key, "market_key")

  let status: CommercialAssortmentStatus = "ACTIVE"
  if (req.body?.status !== undefined) {
    if (typeof req.body.status !== "string" || !STATUSES.includes(req.body.status as CommercialAssortmentStatus)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "invalid status")
    }
    status = req.body.status as CommercialAssortmentStatus
  }

  let regulatory: RegulatoryEligibility = "NOT_EVALUATED"
  if (req.body?.regulatory_eligibility !== undefined) {
    if (
      typeof req.body.regulatory_eligibility !== "string" ||
      !REGS.includes(req.body.regulatory_eligibility as RegulatoryEligibility)
    ) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "invalid regulatory_eligibility")
    }
    regulatory = req.body.regulatory_eligibility as RegulatoryEligibility
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const existing = await b2b.listMarketProductEligibilitys(
    { product_id: productId, market_key: marketKey },
    { take: 1 },
  )

  const payload = {
    product_id: productId,
    market_key: marketKey,
    status,
    regulatory_eligibility: regulatory,
    policy_reference:
      typeof req.body?.policy_reference === "string" ? req.body.policy_reference : null,
    effective_from:
      typeof req.body?.effective_from === "string" ? new Date(req.body.effective_from) : null,
    effective_until:
      typeof req.body?.effective_until === "string" ? new Date(req.body.effective_until) : null,
  }

  const row =
    existing.length > 0
      ? await b2b.updateMarketProductEligibilitys(existing[0].id, payload)
      : await b2b.createMarketProductEligibilitys(payload)

  res.status(existing.length > 0 ? 200 : 201).json({
    market_product_eligibility: row,
    sellable_in_market: isMarketAssortmentSellable({
      assortmentStatus: status,
      regulatoryEligibility: regulatory,
      requireRegulatoryClearance: true,
    }),
  })
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const productId = typeof req.query.product_id === "string" ? req.query.product_id : undefined
  const marketKey = typeof req.query.market_key === "string" ? req.query.market_key : undefined
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const filters: Record<string, string> = {}
  if (productId) filters.product_id = productId
  if (marketKey) filters.market_key = marketKey
  const rows = await b2b.listMarketProductEligibilitys(filters, { take: 200 })
  res.status(200).json({
    market_product_eligibilities: rows.map((row) => ({
      ...row,
      sellable_in_market: isMarketAssortmentSellable({
        assortmentStatus: row.status as CommercialAssortmentStatus,
        regulatoryEligibility: row.regulatory_eligibility as RegulatoryEligibility,
        requireRegulatoryClearance: true,
      }),
    })),
  })
}
