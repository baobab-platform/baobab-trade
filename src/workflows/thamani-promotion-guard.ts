/**
 * Registers a `validate` hook on Medusa's native `updateCartPromotionsWorkflow`
 * as a side effect of importing this file — Medusa's `WorkflowLoader` auto-
 * imports every file under `src/workflows/` on boot (workflows and their
 * hook consumers "register themselves... we only need to import them").
 *
 * This is the ONLY enforcement point for Thamani's promotion policies. An
 * earlier version of this fix put the checks in a wrapper function
 * (`applyThamaniPromotion`) that callers had to remember to use instead of
 * calling `updateCartPromotionsWorkflow` directly — a review caught that
 * this was bypassable three ways:
 *
 *   1. Medusa's own Store API route (`POST /store/carts/:id/promotions`)
 *      calls `updateCartPromotionsWorkflow` directly and never went through
 *      the wrapper at all.
 *   2. The wrapper only checked `cart.currency_code`, not the cart's Sales
 *      Channel — ZuriBeans Uganda and Thamani Uganda share the same Region
 *      and the same currency (UGX), so a ZuriBeans B2B cart could apply a
 *      Thamani consumer promotion code.
 *   3. The wrapper's currency/stacking checks ran as a separate read *before*
 *      `updateCartPromotionsWorkflow`'s own lock was acquired, so two
 *      concurrent requests for different codes on the same empty cart could
 *      both pass the check and both end up applied.
 *
 * Hooking the workflow itself fixes all three: `acquireLockStep` (keyed on
 * the cart id) runs before the `validate` hook fires, so this check is
 * serialized per-cart by Medusa's own lock — and it runs for every caller of
 * `updateCartPromotionsWorkflow`, Store API included, not just a wrapper a
 * caller has to remember to use. `cart` here is already fetched with
 * `cartFieldsForRefreshSteps`, which includes `currency_code`,
 * `sales_channel_id`, and `promotions.code` — no extra query needed for
 * those three.
 *
 * A follow-up review on this hook itself found two more gaps:
 *
 *   4. `input.action` is only ever strictly `ADD`/`REMOVE`/`REPLACE` when a
 *      caller sets it explicitly — Medusa's own default (inside this same
 *      workflow) treats an *omitted* `action` as `ADD`, but this hook's
 *      original `input.action !== PromotionActions.ADD` check treated
 *      omitted as "not ADD" and skipped validation entirely.
 *      `refreshCartItemsWorkflow` also re-invokes this workflow with
 *      `REPLACE` (e.g. after a cart's Sales Channel or currency changes) to
 *      re-apply its already-applied codes — that path bypassed this guard
 *      completely, since it only ever checked `ADD`.
 *   5. The exclusivity check only ever compared Thamani codes already in the
 *      request against each other, not against every other code the
 *      operation would leave applied. `promo_codes: ["THAMANI10", "OTHER"]`
 *      in one `ADD` checked only `THAMANI10`, so Medusa applied both.
 *
 * Both are fixed by computing the *resulting* set of promotion codes the
 * operation would leave on the cart (all of `existingCodes` plus the new
 * ones for `ADD`/default, or exactly `promo_codes` for `REPLACE`) and
 * validating that whole set — currency and estate-scope for every Thamani
 * promotion in it, and exclusivity (at most one Promotion total) across all
 * of it — whenever any Thamani promotion is anywhere in that resulting set,
 * not just in what was newly requested.
 */
import { updateCartPromotionsWorkflow } from "@medusajs/core-flows"
import type { ISalesChannelModuleService } from "@medusajs/framework/types"
import { Modules, PromotionActions } from "@medusajs/framework/utils"
import {
  assertPromotionCurrencyMatchesCart,
  findThamaniPromotionConfig,
  THAMANI_SALES_CHANNEL_KEY,
  ThamaniCartEstateMismatchError,
} from "../baobab/thamani/promotions/promotion-config"
import { assertExclusivePromotionStacking } from "../baobab/thamani/promotions/stacking-policy"

type GuardedCart = {
  currency_code: string
  sales_channel_id: string | null
  promotions?: readonly { code: string }[]
}

updateCartPromotionsWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  // Matches this same workflow's own default a few lines further down
  // (`data.input.action || PromotionActions.ADD`) — an omitted action is a
  // real ADD, not a no-op to skip validation for.
  const action = input.action ?? PromotionActions.ADD
  if (action === PromotionActions.REMOVE) return // can only shrink the set

  const typedCart = cart as GuardedCart
  const requestedCodes = input.promo_codes ?? []
  const existingCodes = (typedCart.promotions ?? []).map((promotion) => promotion.code)

  // The full set of codes this operation would leave applied to the cart —
  // REPLACE discards whatever was there before; ADD/default merges in.
  const resultingCodes =
    action === PromotionActions.REPLACE
      ? requestedCodes
      : [...existingCodes, ...requestedCodes.filter((code) => !existingCodes.includes(code))]

  const resultingThamaniPromotions = resultingCodes
    .map((code) => findThamaniPromotionConfig(code))
    .filter((config) => config !== undefined)
  if (resultingThamaniPromotions.length === 0) return

  const salesChannelService = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const salesChannel = typedCart.sales_channel_id
    ? await salesChannelService.retrieveSalesChannel(typedCart.sales_channel_id)
    : null
  const isThamaniCart =
    salesChannel?.metadata?.baobab_sales_channel_key === THAMANI_SALES_CHANNEL_KEY
  if (!isThamaniCart) {
    throw new ThamaniCartEstateMismatchError(
      resultingThamaniPromotions[0].code,
      typedCart.sales_channel_id,
    )
  }

  for (const config of resultingThamaniPromotions) {
    assertPromotionCurrencyMatchesCart(config, typedCart.currency_code)
  }

  // Exclusivity (at most one Promotion total) applies across the *whole*
  // resulting set once any Thamani promotion is in it — not just between
  // Thamani codes — so a non-Thamani code requested alongside or already
  // applied next to one is caught too.
  let appliedSoFar: string[] = []
  for (const code of resultingCodes) {
    assertExclusivePromotionStacking(appliedSoFar, code)
    appliedSoFar = [...appliedSoFar, code]
  }
})
