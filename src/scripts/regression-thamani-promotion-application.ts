/**
 * DANGER — THIS SCRIPT MUTATES LIVE DATA. It creates disposable test Carts
 * in the Thamani Uganda Region/Sales Channel (and, for one case, the
 * ZuriBeans Uganda Sales Channel), applies real Promotion codes to them via
 * Medusa's own `updateCartPromotionsWorkflow` — the same workflow Medusa's
 * Store API route uses — and asserts the computed discount, then deletes
 * every Cart it created. Medusa's Promotion module only ever computes a
 * discount against a Cart (unlike `ThamaniPricingDecisionPort`, which needs
 * only a bare variant), so proving Gate 9's two demonstration Promotions
 * actually compute the right amount, that the exclusive stacking policy
 * actually blocks a second code, and that a ZuriBeans cart cannot use a
 * Thamani code, requires creating this throwaway commerce state. Following
 * the same lesson Gate 7 review caught (`verify-thamani-search.ts` must stay
 * read-only), this mutation lives in its own script — never inside
 * `verify:thamani-promotions` — and must only run against a disposable
 * database (CI's ephemeral Postgres, or a local scratch database), never a
 * persistent or production environment.
 *
 * This calls `updateCartPromotionsWorkflow` directly, not a wrapper: the
 * enforcement (`src/workflows/thamani-promotion-guard.ts`) is a hook
 * registered on the workflow itself, so it applies here exactly the same
 * way it would to a Store API request — proving the guard is not
 * bypassable, which is the whole point of this regression.
 *
 * An error thrown *inside* a workflow step (the hook) crosses Medusa's
 * transaction-orchestrator boundary on its way back to `.run()`'s caller —
 * it comes out the other side as a plain object (`constructor.name ===
 * "Object"`, `instanceof` no longer matches the original class), not the
 * original error instance. `.name`, `.message`, and any custom own-
 * enumerable fields (`currentlyAppliedCode`, `cartSalesChannelId`, etc.)
 * survive intact, so these checks match on `.name` rather than `instanceof`.
 */
import {
  createCartWorkflow,
  createInventoryLevelsWorkflow,
  createPromotionsWorkflow,
  updateCartPromotionsWorkflow,
} from "@medusajs/core-flows"
import type {
  ExecArgs,
  ICartModuleService,
  IInventoryService,
  IProductModuleService,
  IPromotionModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
} from "@medusajs/framework/types"
import {
  ApplicationMethodTargetType,
  ContainerRegistrationKeys,
  Modules,
  PromotionActions,
} from "@medusajs/framework/utils"
import { findByCountryCode, findByMarketKey, findByMetadataKey } from "../baobab/market/mapping"
import type ThamaniModuleService from "../modules/thamani/service"

/**
 * A throwaway, non-Thamani Promotion — `findThamaniPromotionConfig` returns
 * `undefined` for it — that exists only to prove the exclusivity check
 * catches a Thamani code stacked with *any* other code, not only with a
 * second Thamani-known one. Created idempotently and deleted at the end.
 */
const REGRESSION_OTHER_PROMOTION_CODE = "REGRESSION-OTHER-PROMO"

async function ensureOtherPromotion(
  promotionService: IPromotionModuleService,
  container: ExecArgs["container"],
): Promise<string> {
  const [existing] = await promotionService.listPromotions({
    code: REGRESSION_OTHER_PROMOTION_CODE,
  })
  if (existing) return existing.id

  const { result } = await createPromotionsWorkflow(container).run({
    input: {
      promotionsData: [
        {
          code: REGRESSION_OTHER_PROMOTION_CODE,
          type: "standard",
          status: "active",
          is_automatic: false,
          application_method: {
            type: "percentage",
            target_type: ApplicationMethodTargetType.ITEMS,
            allocation: "across",
            value: 5,
            currency_code: "ugx",
          },
        },
      ],
    },
  })
  return result[0].id
}

const isErrorNamed = (error: unknown, name: string): boolean =>
  typeof error === "object" && error !== null && "name" in error && error.name === name

async function addPromotionCode(
  container: ExecArgs["container"],
  cartId: string,
  code: string,
): Promise<void> {
  await updateCartPromotionsWorkflow(container).run({
    input: { cart_id: cartId, promo_codes: [code], action: PromotionActions.ADD },
  })
}

async function resolveVariant(
  productService: IProductModuleService,
  productHandle: string,
): Promise<{ id: string; sku: string; productId: string }> {
  const [product] = await productService.listProducts(
    { handle: productHandle },
    { relations: ["variants"] },
  )
  const variant = product?.variants?.[0]
  if (!variant?.sku || !product) {
    throw new Error(
      `No product/variant found for handle "${productHandle}" — run bootstrap:thamani-catalogue first`,
    )
  }
  return { id: variant.id, sku: variant.sku, productId: product.id }
}

const REGRESSION_POLICY_REFERENCE = "regression:thamani-promotion-application"

async function ensureDisposableEligibility(
  thamani: ThamaniModuleService,
  productId: string,
  marketKey: string,
): Promise<void> {
  const [existing] = await thamani.listMarketProductEligibilities({
    product_id: productId,
    market_key: marketKey,
  })
  if (existing) {
    throw new Error(
      `Product ${productId} already has a ${marketKey} eligibility record — expected none pending Gate 14 review; ` +
        "refusing to run this destructive fixture against a database whose fixture state isn't as expected",
    )
  }
  await thamani.createMarketProductEligibilities({
    product_id: productId,
    market_key: marketKey,
    status: "ACTIVE",
    policy_reference: REGRESSION_POLICY_REFERENCE,
  })
}

/**
 * Thamani has no Gate 10 (Inventory) yet — every catalogue variant is
 * `manage_inventory: true` with no stock level anywhere, so
 * `createCartWorkflow` refuses to add a line item for it ("not associated
 * with any stock location"). This gives just the two demonstration variants
 * a stock level at Thamani Uganda's own location, scoped to this disposable
 * regression only — it is not a Gate 10 implementation.
 */
async function ensureInventoryLevel(
  container: ExecArgs["container"],
  inventoryService: IInventoryService,
  sku: string,
  stockLocationId: string,
): Promise<void> {
  const [inventoryItem] = await inventoryService.listInventoryItems({ sku })
  if (!inventoryItem) throw new Error(`No inventory item for SKU "${sku}"`)

  const [existingLevel] = await inventoryService.listInventoryLevels({
    inventory_item_id: inventoryItem.id,
    location_id: stockLocationId,
  })
  if (existingLevel) return

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: [
        {
          inventory_item_id: inventoryItem.id,
          location_id: stockLocationId,
          stocked_quantity: 100,
        },
      ],
    },
  })
}

async function createTestCart(
  container: ExecArgs["container"],
  regionId: string,
  salesChannelId: string,
  variantId: string,
): Promise<string> {
  const { result: cart } = await createCartWorkflow(container).run({
    input: {
      region_id: regionId,
      sales_channel_id: salesChannelId,
      items: [{ variant_id: variantId, quantity: 1 }],
    },
  })
  return cart.id
}

async function readCartItemDiscount(
  container: ExecArgs["container"],
  cartId: string,
): Promise<{ discount: number; promotionCodes: string[] }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    // `total`/`subtotal` must be requested alongside `item_discount_total`
    // — Medusa's cart-totals decoration only runs when at least one
    // top-level total field is in the selection; requesting the computed
    // discount field alone silently omits it from the result.
    fields: ["id", "total", "subtotal", "item_discount_total", "promotions.code"],
    filters: { id: [cartId] },
  })
  const cart = data[0] as
    | { item_discount_total: number | string; promotions?: readonly { code: string }[] }
    | undefined
  if (!cart) throw new Error(`Cart "${cartId}" not found while reading back its discount`)
  return {
    // `item_discount_total` comes back as a Medusa BigNumberValue (a
    // stringified decimal, not a plain JS number) — normalise before
    // comparing against an expected integer amount.
    discount: Number(cart.item_discount_total),
    promotionCodes: (cart.promotions ?? []).map((promotion) => promotion.code),
  }
}

export default async function regressionThamaniPromotionApplication({
  container,
}: ExecArgs): Promise<void> {
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const regionService = container.resolve<IRegionModuleService>(Modules.REGION)
  const salesChannelService = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const cartService = container.resolve<ICartModuleService>(Modules.CART)
  const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
  const stockLocationService = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const promotionService = container.resolve<IPromotionModuleService>(Modules.PROMOTION)
  const thamani = container.resolve<ThamaniModuleService>("thamani")

  const regions = await regionService.listRegions({}, { relations: ["countries"] })
  const ugandaRegion = findByCountryCode(regions, "UG")
  if (!ugandaRegion)
    throw new Error("No Region provisioned for Uganda — run bootstrap:market first")

  const salesChannels = await salesChannelService.listSalesChannels({})
  const salesChannel = findByMetadataKey(salesChannels, "baobab_sales_channel_key", "thamani_b2c")
  if (!salesChannel) throw new Error("Run bootstrap:thamani-market before this regression")

  const stockLocations = await stockLocationService.listStockLocations({})
  const ugandaStockLocation = findByMarketKey(stockLocations, "thamani_ug")
  if (!ugandaStockLocation)
    throw new Error("No Thamani Uganda stock location — run bootstrap:thamani-market first")

  const instantCoffee = await resolveVariant(productService, "thamani-instant-coffee-200g")
  const greenTea = await resolveVariant(productService, "thamani-green-tea-100g")
  await ensureInventoryLevel(container, inventoryService, instantCoffee.sku, ugandaStockLocation.id)
  await ensureInventoryLevel(container, inventoryService, greenTea.sku, ugandaStockLocation.id)
  const instantCoffeeVariantId = instantCoffee.id
  const greenTeaVariantId = greenTea.id
  const otherPromotionId = await ensureOtherPromotion(promotionService, container)

  const cartIds: string[] = []
  try {
    // `thamani-cart-eligibility-guard.ts` (a separate Gate 14 fix) rejects
    // adding either fixture item to a cart at all unless it already has an
    // ACTIVE Market eligibility — neither does, since nothing in the launch
    // catalogue is verified yet. Give both a disposable one of this
    // regression's own, scoped to a `policy_reference` that can never be
    // mistaken for a real product's. Inside the try so a failure partway
    // through (e.g. the second call finding an unexpected pre-existing row)
    // still reaches the `finally` cleanup for whichever one did get created.
    await ensureDisposableEligibility(thamani, instantCoffee.productId, "thamani_ug")
    await ensureDisposableEligibility(thamani, greenTea.productId, "thamani_ug")

    // THAMANI10 (10% off, UGX): 10% of the instant coffee's 22,000 UGX
    // standard price is a 2,200 UGX line-item discount.
    const percentageCartId = await createTestCart(
      container,
      ugandaRegion.id,
      salesChannel.id,
      instantCoffeeVariantId,
    )
    cartIds.push(percentageCartId)
    await addPromotionCode(container, percentageCartId, "THAMANI10")
    const afterPercentage = await readCartItemDiscount(container, percentageCartId)
    if (afterPercentage.discount !== 2_200) {
      throw new Error(
        `Expected THAMANI10 to discount 2200 UGX off the instant coffee, got ${afterPercentage.discount}`,
      )
    }
    if (!afterPercentage.promotionCodes.includes("THAMANI10")) {
      throw new Error("Expected THAMANI10 to be applied to the cart")
    }

    // Exclusive stacking (ADR-0012 §34): a second code must be rejected
    // while THAMANI10 is already applied, and must never reach Medusa.
    let stackingRejected = false
    try {
      await addPromotionCode(container, percentageCartId, "THAMANIFIXED2000")
    } catch (error) {
      if (!isErrorNamed(error, "ThamaniPromotionStackingViolationError")) throw error
      stackingRejected = true
    }
    if (!stackingRejected) {
      throw new Error(
        "Expected a second promotion code to be rejected by the exclusive stacking policy",
      )
    }
    const afterStackingAttempt = await readCartItemDiscount(container, percentageCartId)
    if (afterStackingAttempt.promotionCodes.length !== 1) {
      throw new Error(
        `Expected only THAMANI10 to remain applied after the rejected stacking attempt, found [${afterStackingAttempt.promotionCodes.join(", ")}]`,
      )
    }

    // THAMANIFIXED2000 (flat 2,000 UGX off), proven on its own fresh cart
    // so it is not blocked by the stacking policy above.
    const fixedCartId = await createTestCart(
      container,
      ugandaRegion.id,
      salesChannel.id,
      greenTeaVariantId,
    )
    cartIds.push(fixedCartId)
    await addPromotionCode(container, fixedCartId, "THAMANIFIXED2000")
    const afterFixed = await readCartItemDiscount(container, fixedCartId)
    if (afterFixed.discount !== 2_000) {
      throw new Error(
        `Expected THAMANIFIXED2000 to discount 2000 UGX off the green tea, got ${afterFixed.discount}`,
      )
    }

    // Estate isolation: ZuriBeans Uganda shares Thamani Uganda's Region and
    // currency (UGX) — currency alone must never be treated as a Market/
    // estate identifier, or a Thamani consumer promotion could be applied
    // to a ZuriBeans B2B cart.
    const zuribeansSalesChannel = findByMetadataKey(
      salesChannels,
      "baobab_sales_channel_key",
      "zuribeans_b2b",
    )
    if (!zuribeansSalesChannel) {
      throw new Error("Run bootstrap:market before this regression (no ZuriBeans Sales Channel)")
    }
    const { result: zuribeansCart } = await createCartWorkflow(container).run({
      input: { region_id: ugandaRegion.id, sales_channel_id: zuribeansSalesChannel.id },
    })
    cartIds.push(zuribeansCart.id)

    let estateMismatchRejected = false
    try {
      await addPromotionCode(container, zuribeansCart.id, "THAMANI10")
    } catch (error) {
      if (!isErrorNamed(error, "ThamaniCartEstateMismatchError")) throw error
      estateMismatchRejected = true
    }
    if (!estateMismatchRejected) {
      throw new Error(
        "Expected a Thamani promotion code applied to a ZuriBeans cart (same currency, different estate) to fail closed",
      )
    }

    // Exclusivity must cover the WHOLE resulting set, not just Thamani-known
    // codes checked against each other: a Thamani code requested together
    // with any other code in a single ADD call must still be rejected.
    const mixedCartId = await createTestCart(
      container,
      ugandaRegion.id,
      salesChannel.id,
      instantCoffeeVariantId,
    )
    cartIds.push(mixedCartId)
    let mixedRequestRejected = false
    try {
      await updateCartPromotionsWorkflow(container).run({
        input: {
          cart_id: mixedCartId,
          promo_codes: ["THAMANI10", REGRESSION_OTHER_PROMOTION_CODE],
          action: PromotionActions.ADD,
        },
      })
    } catch (error) {
      if (!isErrorNamed(error, "ThamaniPromotionStackingViolationError")) throw error
      mixedRequestRejected = true
    }
    if (!mixedRequestRejected) {
      throw new Error(
        "Expected THAMANI10 requested together with a non-Thamani code in one ADD to fail closed",
      )
    }

    // Same policy, but the non-Thamani code arrives in a second, separate
    // call after a Thamani code is already applied — the guard must not
    // skip validation just because the newly requested code isn't itself
    // Thamani-known.
    const sequentialMixCartId = await createTestCart(
      container,
      ugandaRegion.id,
      salesChannel.id,
      greenTeaVariantId,
    )
    cartIds.push(sequentialMixCartId)
    await addPromotionCode(container, sequentialMixCartId, "THAMANIFIXED2000")
    let secondOtherRejected = false
    try {
      await updateCartPromotionsWorkflow(container).run({
        input: {
          cart_id: sequentialMixCartId,
          promo_codes: [REGRESSION_OTHER_PROMOTION_CODE],
          action: PromotionActions.ADD,
        },
      })
    } catch (error) {
      if (!isErrorNamed(error, "ThamaniPromotionStackingViolationError")) throw error
      secondOtherRejected = true
    }
    if (!secondOtherRejected) {
      throw new Error(
        "Expected a non-Thamani code added after an already-applied Thamani code to fail closed",
      )
    }

    // An omitted `action` defaults to ADD in this same workflow — the guard
    // must validate that path too, not only an explicitly-set ADD.
    const { result: implicitAddCart } = await createCartWorkflow(container).run({
      input: {
        region_id: ugandaRegion.id,
        sales_channel_id: zuribeansSalesChannel.id,
      },
    })
    cartIds.push(implicitAddCart.id)
    let implicitActionRejected = false
    try {
      await updateCartPromotionsWorkflow(container).run({
        input: { cart_id: implicitAddCart.id, promo_codes: ["THAMANI10"] },
      })
    } catch (error) {
      if (!isErrorNamed(error, "ThamaniCartEstateMismatchError")) throw error
      implicitActionRejected = true
    }
    if (!implicitActionRejected) {
      throw new Error(
        "Expected a Thamani code requested with an omitted (implicit ADD) action on a ZuriBeans cart to fail closed",
      )
    }
  } finally {
    if (cartIds.length > 0) await cartService.deleteCarts(cartIds)
    await promotionService.deletePromotions([otherPromotionId])
    const disposableEligibilities = await thamani.listMarketProductEligibilities({
      product_id: [instantCoffee.productId, greenTea.productId],
      market_key: "thamani_ug",
      policy_reference: REGRESSION_POLICY_REFERENCE,
    })
    if (disposableEligibilities.length) {
      await thamani.deleteMarketProductEligibilities(disposableEligibilities.map((e) => e.id))
    }
  }

  container
    .resolve("logger")
    .info("Verified Thamani B2C promotion discount computation and exclusive stacking policy")
}
