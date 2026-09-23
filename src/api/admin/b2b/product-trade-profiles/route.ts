// Gate ZB-06 — upsert commerce trade profile (ADR-0011 / ADR-0030).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import { validateTradeProfileBody } from "../../../../baobab/b2b/product-assortment-admin-validation"

type Body = Record<string, unknown>

export const POST = async (req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) => {
  const validated = validateTradeProfileBody((req.body ?? {}) as Record<string, unknown>)
  if (!validated.ok) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, validated.error.message)
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const productId = validated.data.product_id as string

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const existing = await b2b.listProductTradeProfiles({ product_id: productId }, { take: 1 })

  const payload = {
    product_id: productId,
    canonical_product_key: validated.data.canonical_product_key as string,
    country_of_origin: validated.data.country_of_origin as string,
    hs_classification_reference: validated.data.hs_classification_reference as string,
    classification_system:
      typeof body.classification_system === "string" && body.classification_system.trim()
        ? body.classification_system.trim()
        : "HS",
    classification_confidence: validated.data.classification_confidence,
    commodity_category: validated.data.commodity_category as string,
    trade_uom: validated.data.trade_uom as string,
    net_weight_kg: typeof body.net_weight_kg === "number" ? body.net_weight_kg : null,
    gross_weight_kg: typeof body.gross_weight_kg === "number" ? body.gross_weight_kg : null,
    packaging: typeof body.packaging === "string" ? body.packaging : null,
    lot_controlled: typeof body.lot_controlled === "boolean" ? body.lot_controlled : true,
    batch_controlled: typeof body.batch_controlled === "boolean" ? body.batch_controlled : true,
    export_eligibility_reference:
      typeof body.export_eligibility_reference === "string"
        ? body.export_eligibility_reference
        : null,
    commodity_attributes:
      body.commodity_attributes && typeof body.commodity_attributes === "object"
        ? body.commodity_attributes
        : null,
  }

  const row =
    existing.length > 0
      ? await b2b.updateProductTradeProfiles(existing[0].id, payload)
      : await b2b.createProductTradeProfiles(payload)

  res.status(existing.length > 0 ? 200 : 201).json({ product_trade_profile: row })
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const productId = typeof req.query.product_id === "string" ? req.query.product_id : undefined
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const rows = await b2b.listProductTradeProfiles(productId ? { product_id: productId } : {}, {
    take: 100,
  })
  res.status(200).json({ product_trade_profiles: rows })
}
