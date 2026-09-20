// Gate ZB-06 — upsert commerce trade profile (ADR-0011 / ADR-0030).
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import {
  isKnownTradeUom,
  normalizeTradeUom,
  type ClassificationConfidence,
} from "../../../../baobab/b2b/product-assortment-policy"

type Body = {
  product_id?: unknown
  canonical_product_key?: unknown
  country_of_origin?: unknown
  hs_classification_reference?: unknown
  classification_system?: unknown
  classification_confidence?: unknown
  commodity_category?: unknown
  trade_uom?: unknown
  net_weight_kg?: unknown
  gross_weight_kg?: unknown
  packaging?: unknown
  lot_controlled?: unknown
  batch_controlled?: unknown
  export_eligibility_reference?: unknown
  commodity_attributes?: unknown
}

const CONFIDENCES: ClassificationConfidence[] = [
  "PROPOSED",
  "UNDER_REVIEW",
  "VERIFIED",
  "AUTHORITATIVE",
  "DISPUTED",
  "EXPIRED",
]

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${field} is required`)
  }
  return value.trim()
}

export const POST = async (req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) => {
  const productId = requireString(req.body?.product_id, "product_id")
  const canonicalKey = requireString(req.body?.canonical_product_key, "canonical_product_key")
  const country = requireString(req.body?.country_of_origin, "country_of_origin")
  const hs = requireString(req.body?.hs_classification_reference, "hs_classification_reference")
  const category = requireString(req.body?.commodity_category, "commodity_category")
  const uomRaw = requireString(req.body?.trade_uom, "trade_uom")
  const tradeUom = normalizeTradeUom(uomRaw)
  if (!isKnownTradeUom(tradeUom)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `trade_uom "${tradeUom}" is not a recognised trade unit code`,
    )
  }

  let confidence: ClassificationConfidence = "PROPOSED"
  if (req.body?.classification_confidence !== undefined) {
    if (
      typeof req.body.classification_confidence !== "string" ||
      !CONFIDENCES.includes(req.body.classification_confidence as ClassificationConfidence)
    ) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "invalid classification_confidence")
    }
    confidence = req.body.classification_confidence as ClassificationConfidence
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const existing = await b2b.listProductTradeProfiles({ product_id: productId }, { take: 1 })

  const payload = {
    product_id: productId,
    canonical_product_key: canonicalKey,
    country_of_origin: country,
    hs_classification_reference: hs,
    classification_system:
      typeof req.body?.classification_system === "string" && req.body.classification_system.trim()
        ? req.body.classification_system.trim()
        : "HS",
    classification_confidence: confidence,
    commodity_category: category,
    trade_uom: tradeUom,
    net_weight_kg: typeof req.body?.net_weight_kg === "number" ? req.body.net_weight_kg : null,
    gross_weight_kg: typeof req.body?.gross_weight_kg === "number" ? req.body.gross_weight_kg : null,
    packaging: typeof req.body?.packaging === "string" ? req.body.packaging : null,
    lot_controlled: typeof req.body?.lot_controlled === "boolean" ? req.body.lot_controlled : true,
    batch_controlled:
      typeof req.body?.batch_controlled === "boolean" ? req.body.batch_controlled : true,
    export_eligibility_reference:
      typeof req.body?.export_eligibility_reference === "string"
        ? req.body.export_eligibility_reference
        : null,
    commodity_attributes:
      req.body?.commodity_attributes && typeof req.body.commodity_attributes === "object"
        ? req.body.commodity_attributes
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
  const rows = await b2b.listProductTradeProfiles(
    productId ? { product_id: productId } : {},
    { take: 100 },
  )
  res.status(200).json({ product_trade_profiles: rows })
}
