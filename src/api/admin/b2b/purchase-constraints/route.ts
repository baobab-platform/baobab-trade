// Gate ZB-06 — purchase constraints with trade UOM aligned to assortment policy.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import { validatePurchaseConstraintBody } from "../../../../baobab/b2b/product-assortment-admin-validation"

type Body = Record<string, unknown>

export const POST = async (req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) => {
  const validated = validatePurchaseConstraintBody((req.body ?? {}) as Record<string, unknown>)
  if (!validated.ok) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, validated.error.message)
  }

  const variantId = validated.data.variant_id as string
  const marketKey = validated.data.market_key as string
  const moq = validated.data.minimum_order_quantity as number
  const multiple = validated.data.order_multiple as number
  const tradeUom = validated.data.trade_uom as string

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
