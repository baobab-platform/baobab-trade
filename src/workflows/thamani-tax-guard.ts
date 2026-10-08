/**
 * Registers a `setTaxLineContext` hook on Medusa's native
 * `updateTaxLinesWorkflow`, `upsertTaxLinesWorkflow`, and
 * `updateOrderTaxLinesWorkflow` as a side effect of importing this file —
 * Medusa's `WorkflowLoader` auto-imports every file under `src/workflows/`
 * on boot, the same mechanism `thamani-promotion-guard.ts` relies on.
 *
 * `refreshCartItemsWorkflow` (core-flows) invokes the first two directly,
 * and it itself runs on every real cart mutation (add-to-cart,
 * update-line-item, etc.) — so this hook is a genuine, real-checkout
 * integration point, not an obscure or test-only one. A cart's own tax
 * lines carry over to its order at checkout unchanged (`complete-cart.js`
 * never recalculates them), but `updateOrderTaxLinesWorkflow` recomputes
 * tax independently for draft orders, claims, exchanges, returns, and
 * order edits — a review found that without a hook there too, any of those
 * silently replaces a Thamani order's real VAT with the provider's
 * native-passthrough 0%.
 *
 * `setTaxLineContext` can only inject `additional_context` for the tax
 * provider to read; it cannot override the computed rate itself. The actual
 * rate computation happens in `../modules/thamani-tax-provider/service.ts`
 * — a Tax Provider whose own container is module-isolated and so cannot
 * reach the `thamani` or Sales Channel services itself. This hook does that
 * cross-module work (it runs with full app-container access, like any
 * workflow hook) and hands the provider only what it needs: whether this is
 * a Thamani cart/order, and each line item's `product_tax_category`.
 */
import {
  updateOrderTaxLinesWorkflow,
  updateTaxLinesWorkflow,
  upsertTaxLinesWorkflow,
} from "@medusajs/core-flows"
import type {
  ISalesChannelModuleService,
  MedusaContainer,
  RemoteQueryFunction,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { THAMANI_DIGITAL_ESTATE_CANONICAL_ID } from "../baobab/context/digital-estates"
import { THAMANI_SALES_CHANNEL_KEY } from "../baobab/thamani/promotions/promotion-config"
import type { ThamaniTaxLineContext } from "../modules/thamani-tax-provider/service"
import type ThamaniModuleService from "../modules/thamani/service"

type GuardedCart = { id: string; sales_channel_id?: string | null }
type GuardedItem = { id: string; product_id?: string | null }

const isThamaniEntity = async (
  entity: "cart" | "order",
  entityId: string,
  container: MedusaContainer,
): Promise<boolean> => {
  const query = container.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity,
    fields: ["sales_channel_id"],
    filters: { id: entityId },
  })
  const salesChannelId = (data[0] as { sales_channel_id?: string | null } | undefined)
    ?.sales_channel_id
  if (!salesChannelId) return false
  const salesChannelService = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const salesChannel = await salesChannelService.retrieveSalesChannel(salesChannelId)
  return salesChannel.metadata?.baobab_sales_channel_key === THAMANI_SALES_CHANNEL_KEY
}

const buildItemTaxCategoryByLineItemId = async (
  items: readonly GuardedItem[],
  container: MedusaContainer,
): Promise<ThamaniTaxLineContext["itemTaxCategoryByLineItemId"]> => {
  const productIds = [
    ...new Set(items.map((item) => item.product_id).filter((id): id is string => Boolean(id))),
  ]
  if (productIds.length === 0) return {}

  const thamani = container.resolve<ThamaniModuleService>("thamani")
  const profiles = await thamani.listProductRetailProfiles({ product_id: productIds })
  const categoryByProductId = new Map(
    profiles.map((profile) => [profile.product_id, profile.product_tax_category]),
  )

  const result: ThamaniTaxLineContext["itemTaxCategoryByLineItemId"] = {}
  for (const item of items) {
    const category = item.product_id ? categoryByProductId.get(item.product_id) : undefined
    if (category) result[item.id] = category
  }
  return result
}

const setThamaniTaxLineContext = async (
  entity: "cart" | "order",
  record: GuardedCart,
  items: readonly GuardedItem[] | undefined,
  container: MedusaContainer,
): Promise<StepResponse<ThamaniTaxLineContext | undefined>> => {
  if (!(await isThamaniEntity(entity, record.id, container))) return new StepResponse(undefined)
  return new StepResponse({
    digitalEstate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
    itemTaxCategoryByLineItemId: await buildItemTaxCategoryByLineItemId(items ?? [], container),
  })
}

updateTaxLinesWorkflow.hooks.setTaxLineContext(async ({ cart, items }, { container }) =>
  setThamaniTaxLineContext(
    "cart",
    cart as GuardedCart,
    items as GuardedItem[] | undefined,
    container,
  ),
)

upsertTaxLinesWorkflow.hooks.setTaxLineContext(async ({ cart, items }, { container }) =>
  setThamaniTaxLineContext(
    "cart",
    cart as GuardedCart,
    items as GuardedItem[] | undefined,
    container,
  ),
)

updateOrderTaxLinesWorkflow.hooks.setTaxLineContext(async ({ order, items }, { container }) =>
  setThamaniTaxLineContext(
    "order",
    order as GuardedCart,
    (items as GuardedItem[] | undefined) ?? (order as { items?: GuardedItem[] }).items,
    container,
  ),
)
