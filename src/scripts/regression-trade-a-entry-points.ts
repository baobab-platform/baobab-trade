/**
 * ADR-SHARED-039 Trade-A TA-06 disposable PostgreSQL / real Medusa acceptance
 * for the workflow-layer entry-point closure. Real Thamani carts and the real
 * completeCartWorkflow and createOrderWorkflow are invoked DIRECTLY (no HTTP),
 * under a protected runtime profile set in-process.
 *
 * Expected: every attempt is denied before an order row exists, with the
 * ADR-SHARED-039 §6 outcome, and the explicit local sandbox is unchanged.
 * Nothing here contacts CP: protected runtimes deny before any dependency.
 * Engine-local, synthetic evidence only: not EA Gate D, not L4.
 */
import assert from "node:assert/strict"
import {
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  createCartWorkflow,
  createInventoryLevelsWorkflow,
  createOrderWorkflow,
  createPaymentCollectionForCartWorkflow,
} from "@medusajs/core-flows"
import type {
  ExecArgs,
  ICartModuleService,
  IFulfillmentModuleService,
  IInventoryService,
  IPaymentModuleService,
  IProductModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { findByCountryCode, findByMarketKey, findByMetadataKey } from "../baobab/market/mapping"
import { TRADE_A_ENFORCEMENT_ENV } from "../baobab/orders/trade-a-entry-points"
import type ThamaniModuleService from "../modules/thamani/service"

const POLICY_REFERENCE = "regression:trade-a-ta06-entry-points"
const EMAIL = "regression-trade-a-ta06@example.invalid"
const PROFILE_KEYS = ["BAOBAB_ENVIRONMENT", "BAOBAB_DEPLOYMENT_ENV", TRADE_A_ENFORCEMENT_ENV]

export default async function regressionTradeAEntryPoints({ container }: ExecArgs) {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_BINDING_LIFECYCLE_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.BAOBAB_LA05_NATIVE_CHECKOUT_GUARD === "true" ||
    PROFILE_KEYS.some((key) => process.env[key] !== undefined) ||
    !expected ||
    !url ||
    new URL(url).pathname !== `/${expected}`
  ) {
    throw new Error(
      "Trade-A entry-point regression requires the explicitly marked disposable test database",
    )
  }
  const carts = container.resolve<ICartModuleService>(Modules.CART)
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const regions = container.resolve<IRegionModuleService>(Modules.REGION)
  const channels = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const locations = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
  const fulfillment = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
  const payments = container.resolve<IPaymentModuleService>(Modules.PAYMENT)
  const thamani = container.resolve<ThamaniModuleService>("thamani")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const uganda = findByCountryCode(
    await regions.listRegions({}, { relations: ["countries"] }),
    "UG",
  )
  const channel = findByMetadataKey(
    await channels.listSalesChannels({}),
    "baobab_sales_channel_key",
    "thamani_b2c",
  )
  const location = findByMarketKey(await locations.listStockLocations({}), "thamani_ug")
  const [shipping] = await fulfillment.listShippingOptions({
    name: "Thamani Uganda Standard Shipping (development placeholder rate)",
  })
  if (!uganda || !channel || !location || !shipping)
    throw new Error("Run the Thamani market, catalogue and fulfilment bootstraps first")
  const [product] = await products.listProducts(
    { handle: "thamani-instant-coffee-200g" },
    { relations: ["variants"] },
  )
  const variant = product?.variants?.[0]
  if (!product || !variant?.sku) throw new Error("Thamani regression product missing")
  const [item] = await inventory.listInventoryItems({ sku: variant.sku })
  const [level] = item
    ? await inventory.listInventoryLevels({ inventory_item_id: item.id, location_id: location.id })
    : []
  if (item && !level)
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: [
          { inventory_item_id: item.id, location_id: location.id, stocked_quantity: 100 },
        ],
      },
    })
  const [eligible] = await thamani.listMarketProductEligibilities({
    product_id: product.id,
    market_key: "thamani_ug",
  })
  if (!eligible)
    await thamani.createMarketProductEligibilities({
      product_id: product.id,
      market_key: "thamani_ug",
      status: "ACTIVE",
      policy_reference: POLICY_REFERENCE,
    })

  /** A real, completable Thamani Uganda cart with a pending payment session. */
  const payableCart = async () => {
    const { result: cart } = await createCartWorkflow(container).run({
      input: {
        region_id: uganda.id,
        sales_channel_id: channel.id,
        items: [{ variant_id: variant.id, quantity: 1 }],
        email: EMAIL,
      },
    })
    await addShippingMethodToCartWorkflow(container).run({
      input: { cart_id: cart.id, options: [{ id: shipping.id }] },
    })
    const collection = await createPaymentCollectionForCartWorkflow(container).run({
      input: { cart_id: cart.id },
    })
    await payments.createPaymentSession(collection.result.id, {
      provider_id: "pp_system_default",
      currency_code: cart.currency_code,
      amount: collection.result.amount ?? cart.total ?? 0,
      data: {},
    })
    return cart.id
  }
  const cartOrders = async (id: string) => {
    const { data } = await query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: id },
    })
    return data.map((link: { order_id: string }) => link.order_id)
  }
  const ordersByEmail = async () => {
    const { data } = await query.graph({
      entity: "order",
      fields: ["id"],
      filters: { email: EMAIL },
    })
    return data.length
  }
  /** Workflow failures are rethrown serialised ({ message, ... }), not as Error. */
  const denied = async (attempt: Promise<unknown>, outcome: string) => {
    const error = await attempt.then(
      () => undefined,
      (e: unknown) => e,
    )
    const message =
      error instanceof Error
        ? error.message
        : String((error as { message?: unknown } | undefined)?.message ?? "")
    assert.match(message, new RegExp(`Trade-A order authority denied \\(${outcome}\\)`), message)
  }
  const withProfile = async (profile: Record<string, string>, run: () => Promise<void>) => {
    Object.assign(process.env, profile)
    try {
      await run()
    } finally {
      for (const key of PROFILE_KEYS) Reflect.deleteProperty(process.env, key)
    }
  }
  const complete = (id: string) => completeCartWorkflow(container).run({ input: { id } })
  const directOrder = (draft: boolean) =>
    createOrderWorkflow(container).run({
      input: {
        region_id: uganda.id,
        sales_channel_id: channel.id,
        email: EMAIL,
        currency_code: "ugx",
        items: [{ variant_id: variant.id, quantity: 1, title: product.title, unit_price: 10000 }],
        ...(draft ? { is_draft_order: true, status: "draft" as const } : {}),
      },
    })

  try {
    const cartId = await payableCart()
    const baseline = await ordersByEmail()

    // 1. Protected staging. TA-08 certifies trade.order.commit, so the
    //    validate hook needs explicit enablement before any dependency, and
    //    then trusted CP/IAM configuration this regression does not provide:
    //    certification is never activation. (TA-08's real-CP acceptance,
    //    acceptance/trade-a, proves the authorised path.)
    await withProfile({ BAOBAB_ENVIRONMENT: "staging" }, async () => {
      await denied(complete(cartId), "PROTECTED_RUNTIME")
      process.env[TRADE_A_ENFORCEMENT_ENV] = "true"
      await denied(complete(cartId), "UNAVAILABLE")
    })
    // 2. Production stays denied, enabled or not.
    await withProfile(
      { BAOBAB_ENVIRONMENT: "production", [TRADE_A_ENFORCEMENT_ENV]: "true" },
      async () => denied(complete(cartId), "PROTECTED_RUNTIME"),
    )
    // 3. Local enforcement with no trusted CP/IAM configuration fails closed (503 class).
    await withProfile({ [TRADE_A_ENFORCEMENT_ENV]: "true" }, async () =>
      denied(complete(cartId), "UNAVAILABLE"),
    )
    assert.equal((await carts.retrieveCart(cartId)).completed_at, null)
    assert.deepEqual(await cartOrders(cartId), [])

    // 4. Direct and draft order creation have no governed commit point.
    for (const draft of [false, true]) {
      await withProfile({ BAOBAB_ENVIRONMENT: "staging" }, async () =>
        denied(directOrder(draft), "NO_GOVERNED_COMMIT_POINT"),
      )
      await withProfile({ [TRADE_A_ENFORCEMENT_ENV]: "true" }, async () =>
        denied(directOrder(draft), "NO_GOVERNED_COMMIT_POINT"),
      )
    }
    assert.equal(await ordersByEmail(), baseline, "no order row may exist after a denial")

    // 5. The explicit local sandbox is unchanged: a draft is created and the
    //    cart completes through the same hooks.
    await directOrder(true)
    assert.equal(await ordersByEmail(), baseline + 1)
    const { result: order } = await complete(cartId)
    assert.deepEqual(await cartOrders(cartId), [order.id])

    console.log(
      "Trade-A TA-06: real completeCartWorkflow and createOrderWorkflow invoked directly are denied in staging, production and misconfigured local enforcement before any order row (synthetic, engine-local; not EA Gate D, not L4)",
    )
  } finally {
    if (!eligible)
      await thamani
        .listMarketProductEligibilities({
          product_id: product.id,
          policy_reference: POLICY_REFERENCE,
        })
        .then((rows) => thamani.deleteMarketProductEligibilities(rows.map((row) => row.id)))
  }
}
