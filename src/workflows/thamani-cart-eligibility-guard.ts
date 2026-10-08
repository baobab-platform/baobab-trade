/**
 * Registers a `validate` hook on Medusa's native `createCartWorkflow`,
 * `addToCartWorkflow`, and `completeCartWorkflow` as a side effect of
 * importing this file — the same `WorkflowLoader` auto-import mechanism
 * `thamani-promotion-guard.ts` and `thamani-tax-guard.ts` rely on.
 *
 * A review of the Gate 14 fail-closed compliance fix found it only ever
 * withheld a product's *searchability* (`MarketProductEligibility` feeding
 * the search index) and its resolution through
 * `MedusaThamaniPricingDecisionPort` (Gate 8) — neither of which any real
 * Store API request actually goes through to put an item in a cart.
 * `createCartWorkflow` (with initial `items`) and `addToCartWorkflow` are
 * what the Create Cart and Add Line Item Store API Routes call — and
 * neither invokes the other internally, so both need their own hook — so a
 * caller who already knows a variant ID (from the product list API, a
 * sitemap, or just guessing) could add, and go on to purchase, a product
 * with no verified Market eligibility at all.
 *
 * A follow-up review found that guarding only the add-time hooks still left
 * two gaps: a cart's `region_id`/`sales_channel_id` can change after an
 * eligible item was added (`updateCartWorkflow`), and an item's eligibility
 * can be revoked after it was added — neither add-time hook re-runs for
 * either case. Rather than also hooking every mutation that can change a
 * cart's state, `completeCartWorkflow`'s own `validate` hook — which fires
 * once, right before the order is created, against the cart's actual final
 * state — is hooked too, so it re-validates every existing line item
 * against the cart's Market at the one point that actually matters: the
 * point of no return. Together these are the ONLY enforcement point for
 * eligibility on cart mutations, mirroring how `thamani-promotion-guard.ts`
 * is the only enforcement point for promotion policy.
 *
 * Scoped to Thamani carts only, via the same Sales Channel tag every other
 * guard in this codebase uses — all three workflows are shared with
 * ZuriBeans and any other estate.
 */
import { addToCartWorkflow, completeCartWorkflow, createCartWorkflow } from "@medusajs/core-flows"
import type {
  IProductModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { THAMANI_LAUNCH_MARKETS } from "../baobab/market/thamani-market-config"
import { ThamaniProductNotEligibleForMarketError } from "../baobab/thamani/pricing/decision-port"
import { THAMANI_SALES_CHANNEL_KEY } from "../baobab/thamani/promotions/promotion-config"
import type ThamaniModuleService from "../modules/thamani/service"

type GuardedCart = {
  sales_channel_id?: string | null
  region_id?: string | null
  region?: { id: string } | null
}
type GuardedItem = { variant_id?: string | null }

const assertItemsEligible = async (
  cart: GuardedCart,
  items: readonly GuardedItem[] | undefined,
  container: MedusaContainer,
): Promise<void> => {
  const salesChannelService = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const salesChannel = cart.sales_channel_id
    ? await salesChannelService.retrieveSalesChannel(cart.sales_channel_id)
    : null
  const isThamaniCart =
    salesChannel?.metadata?.baobab_sales_channel_key === THAMANI_SALES_CHANNEL_KEY
  if (!isThamaniCart) return

  const variantIds = (items ?? [])
    .map((item) => item.variant_id)
    .filter((id): id is string => Boolean(id))
  if (variantIds.length === 0) return

  const regionId = cart.region_id ?? cart.region?.id
  const regionService = container.resolve<IRegionModuleService>(Modules.REGION)
  const region = regionId
    ? await regionService.retrieveRegion(regionId, { relations: ["countries"] })
    : null
  const countryCode = region?.countries?.[0]?.iso_2?.toUpperCase()
  const market = THAMANI_LAUNCH_MARKETS.find((candidate) => candidate.countryCode === countryCode)
  if (!market) {
    throw new Error(`No Thamani Market is configured for cart region country "${countryCode}"`)
  }

  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const thamani = container.resolve<ThamaniModuleService>("thamani")

  const variants = await productService.listProductVariants(
    { id: variantIds },
    { select: ["id", "product_id"] },
  )
  const productIds = [
    ...new Set(
      variants.map((variant) => variant.product_id).filter((id): id is string => Boolean(id)),
    ),
  ]
  const eligibilities = productIds.length
    ? await thamani.listMarketProductEligibilities({
        product_id: productIds,
        market_key: market.marketKey,
      })
    : []
  const activeProductIds = new Set(
    eligibilities
      .filter((eligibility) => eligibility.status === "ACTIVE")
      .map((eligibility) => eligibility.product_id),
  )

  for (const variant of variants) {
    if (!variant.product_id || !activeProductIds.has(variant.product_id)) {
      throw new ThamaniProductNotEligibleForMarketError(variant.id, market.marketKey)
    }
  }
}

createCartWorkflow.hooks.validate(async ({ cart }, { container }) =>
  assertItemsEligible(cart as GuardedCart, (cart as { items?: GuardedItem[] }).items, container),
)

addToCartWorkflow.hooks.validate(async ({ input, cart }, { container }) =>
  assertItemsEligible(cart as GuardedCart, input.items as GuardedItem[] | undefined, container),
)

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) =>
  assertItemsEligible(cart as GuardedCart, (cart as { items?: GuardedItem[] }).items, container),
)
