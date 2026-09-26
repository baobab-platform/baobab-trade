// Gate ZB-06 — market assortment + regulatory eligibility (ADR-0024 / ADR-0030).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import { validateMarketEligibilityBody } from "../../../../baobab/b2b/product-assortment-admin-validation"
import {
  isMarketAssortmentSellable,
  type CommercialAssortmentStatus,
  type RegulatoryEligibility,
} from "../../../../baobab/b2b/product-assortment-policy"

type Body = Record<string, unknown>

export const POST = async (req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) => {
  const validated = validateMarketEligibilityBody((req.body ?? {}) as Record<string, unknown>)
  if (!validated.ok) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, validated.error.message)
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const productId = validated.data.product_id as string
  const marketKey = validated.data.market_key as string
  const status = validated.data.status as CommercialAssortmentStatus
  const regulatory = validated.data.regulatory_eligibility as RegulatoryEligibility

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
    policy_reference: typeof body.policy_reference === "string" ? body.policy_reference : null,
    effective_from: typeof body.effective_from === "string" ? new Date(body.effective_from) : null,
    effective_until:
      typeof body.effective_until === "string" ? new Date(body.effective_until) : null,
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
