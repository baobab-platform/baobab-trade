// Gate ZB-06 — market assortment filter for catalogue composition (ADR-0011 §29–34, ADR-0024).
// Returns product ids that are commercially ACTIVE and regulatory-permissive in a market.
// Does not replace Medusa /store/products; estates compose this filter with stock catalogue.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import { partitionCurrentMarketAssortment } from "../../../../baobab/b2b/product-assortment-policy"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const marketKey = req.query.market_key
  if (typeof marketKey !== "string" || marketKey.trim() === "") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "market_key query parameter is required")
  }

  // Store callers cannot request the administrative preview's relaxed mode.
  if (
    ![undefined, "true", "1"].includes(req.query.require_regulatory_clearance as string | undefined)
  ) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "regulatory clearance is mandatory")
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const rows = await b2b.listMarketProductEligibilities(
    { market_key: marketKey.trim() },
    { take: 500 },
  )

  const partition = partitionCurrentMarketAssortment(rows, new Date())

  res.setHeader("Cache-Control", "no-store")
  res.status(200).json({
    market_key: marketKey.trim(),
    require_regulatory_clearance: true,
    ...partition,
  })
}
