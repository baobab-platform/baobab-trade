// ADR-0011 §§27–34, 75, 84, 90–92, 95–96: the B2B assortment
// endpoint is a restricted buyer-specific catalogue, NOT a public Market
// directory. Medusa /store/products does not inherit this entitlement;
// its own boundary must be qualified separately before production promotion.
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import { partitionCurrentMarketAssortment } from "../../../../baobab/b2b/product-assortment-policy"
import {
  PRODUCT_CATALOGUE_ACCESS,
  assertVerifiedCatalogueAccess,
  assertVisibleProductSubset,
  type ProductCatalogueAccessPort,
} from "../../../../baobab/catalogue/visibility-authority"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "no-store")
  const marketKey = req.query.market_key
  if (typeof marketKey !== "string" || !marketKey.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "market_key query parameter is required")
  }
  // A browser cannot select a soft regulatory clearance or diagnostics mode.
  if (
    ![undefined, "true", "1"].includes(req.query.require_regulatory_clearance as string | undefined)
  ) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "regulatory clearance is mandatory")
  }

  // No unverified local tenant, unsigned header or generic Medusa customer
  // session can authorise cross-organisation product discovery. This port
  // must be installed by a real IAM/CP buyer/estate Market verifier.
  let accessPort: ProductCatalogueAccessPort
  try {
    accessPort = req.scope.resolve<ProductCatalogueAccessPort>(PRODUCT_CATALOGUE_ACCESS)
  } catch {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "B2B catalogue unavailable")
  }
  if (
    !accessPort ||
    typeof accessPort.authorizeRequest !== "function" ||
    typeof accessPort.visibleProductIds !== "function"
  ) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "B2B catalogue unavailable")
  }
  const requestedMarketKey = marketKey.trim()
  let access
  try {
    access = assertVerifiedCatalogueAccess(
      await accessPort.authorizeRequest(req, requestedMarketKey),
      requestedMarketKey,
    )
  } catch {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "B2B catalogue unavailable")
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const rows = await b2b.listMarketProductEligibilities(
    { market_key: access.marketKey },
    { take: 500 },
  )

  // Never trust a filter alone as a security boundary: a source mistakenly
  // returning another Market's rows must not leak either its products or
  // reasons for withholding them.
  const scopedRows = rows.filter((row) => row.market_key === access.marketKey)
  const eligible = partitionCurrentMarketAssortment(scopedRows, new Date()).sellable_product_ids
  let visible: string[]
  try {
    visible = assertVisibleProductSubset(
      eligible,
      await accessPort.visibleProductIds(access, eligible),
    )
  } catch {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "B2B catalogue unavailable")
  }

  // Never return blocked product IDs, classification failures, diagnostics,
  // rejected candidates, or internal cost/contract metadata to Store callers.
  res.status(200).json({
    market_key: access.marketKey,
    require_regulatory_clearance: true,
    sellable_product_ids: visible,
  })
}
