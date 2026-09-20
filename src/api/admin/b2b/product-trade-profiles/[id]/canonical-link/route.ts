// Gate ZB-06 — Trade-side write path for product canonical correlation (ADR-0011 §5).
// Operator sets canonical_product_key after CP links a PRODUCT CanonicalEntity
// external reference to this engine's Medusa product id. Does not mint CP ids.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../../modules/b2b"
import type B2BModuleService from "../../../../../../modules/b2b/service"

type Body = {
  canonical_product_key?: unknown
}

export const POST = async (req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) => {
  const canonicalProductKey = req.body?.canonical_product_key
  if (typeof canonicalProductKey !== "string" || canonicalProductKey.trim() === "") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "canonical_product_key is required in the request body",
    )
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  await b2b.retrieveProductTradeProfile(req.params.id)

  const updated = await b2b.updateProductTradeProfiles(req.params.id, {
    canonical_product_key: canonicalProductKey.trim(),
  })

  res.status(200).json({
    id: updated.id,
    product_id: updated.product_id,
    canonical_product_key: updated.canonical_product_key,
  })
}
