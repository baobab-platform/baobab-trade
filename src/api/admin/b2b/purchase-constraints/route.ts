// Gate ZB-06 — purchase constraints with trade UOM aligned to assortment policy.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import {
  isKnownTradeUom,
  normalizeTradeUom,
} from "../../../../baobab/b2b/product-assortment-policy"

type Body = {
  variant_id?: unknown
  market_key?: unknown
  minimum_order_quantity?: unknown
  order_multiple?: unknown
  trade_uom?: unknown
}

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${field} is required`)
  }
  return value.trim()
}

const requirePositiveInt = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${field} must be a positive integer`)
  }
  return value
}

export const POST = async (req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) => {
  const variantId = requireString(req.body?.variant_id, "variant_id")
  const marketKey = requireString(req.body?.market_key, "market_key")
  const moq = requirePositiveInt(req.body?.minimum_order_quantity, "minimum_order_quantity")
  const multiple = requirePositiveInt(req.body?.order_multiple, "order_multiple")
  const tradeUom = normalizeTradeUom(requireString(req.body?.trade_uom, "trade_uom"))
  if (!isKnownTradeUom(tradeUom)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `trade_uom "${tradeUom}" is not a recognised trade unit code`,
    )
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const existing = await b2b.listPurchaseConstraints(
    { variant_id: variantId, market_key: marketKey },
    { take: 1 },
  )

  const payload = {
    variant_id: variantId,
    market_key: marketKey,
    minimum_order_quantity: moq,
    order_multiple: multiple,
    trade_uom: tradeUom,
  }

  const row =
    existing.length > 0
      ? await b2b.updatePurchaseConstraints(existing[0].id, payload)
      : await b2b.createPurchaseConstraints(payload)

  res.status(existing.length > 0 ? 200 : 201).json({ purchase_constraint: row })
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const variantId = typeof req.query.variant_id === "string" ? req.query.variant_id : undefined
  const marketKey = typeof req.query.market_key === "string" ? req.query.market_key : undefined
  const filters: Record<string, string> = {}
  if (variantId) filters.variant_id = variantId
  if (marketKey) filters.market_key = marketKey

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const rows = await b2b.listPurchaseConstraints(filters, { take: 200 })
  res.status(200).json({ purchase_constraints: rows })
}
