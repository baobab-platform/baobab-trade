/**
 * ADR-SHARED-039 Trade-A TA-08: the Trade-side half of the real-CP
 * acceptance harness (acceptance/trade-a). The harness driver runs it inside
 * the shipped Trade image with `medusa exec`, one command per call:
 *
 *   fixture             publishable key and the Thamani Uganda scope
 *   cart                a real, payable Thamani Uganda cart
 *   draft               a draft order (local-profile fixture only)
 *   complete <cart>     completeCartWorkflow, directly (no HTTP)
 *   finalize <draft>    convertDraftOrderWorkflow, directly (no HTTP)
 *   create-order        createOrderWorkflow, directly (no HTTP)
 *   posture             the TA-08 persistence-posture verdict
 *
 * Each command prints one line `TA08 <json>` for the driver. Building carts
 * and drafts is fixture work: payment sessions are Trade-C (denied over HTTP
 * in protected runtimes), so the cart's pp_system_default session is created
 * at module level. The commit operations are what the harness accepts.
 *
 * It refuses production, any database other than the one the harness marks,
 * and any run without BAOBAB_TRADE_A_ACCEPTANCE=true. Nothing it creates is
 * authority: CP decides every commit.
 */
import { randomUUID } from "node:crypto"
import {
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  convertDraftOrderWorkflow,
  createApiKeysWorkflow,
  createCartWorkflow,
  createInventoryLevelsWorkflow,
  createOrderWorkflow,
  createPaymentCollectionForCartWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/core-flows"
import type {
  ExecArgs,
  IFulfillmentModuleService,
  IInventoryService,
  IPaymentModuleService,
  IProductModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"
import { findByCountryCode, findByMarketKey, findByMetadataKey } from "../baobab/market/mapping"
import { resolveNativeCheckoutEnvironment } from "../baobab/orders/native-cart-legal-seller"
import { PostgresPersistencePostureReader } from "../baobab/orders/persistence-posture"
import type ThamaniModuleService from "../modules/thamani/service"

const POLICY_REFERENCE = "acceptance:trade-a-ta08"

/** Workflow failures are rethrown serialised ({ message, ... }), not as Error. */
const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : String((error as { message?: unknown } | undefined)?.message ?? error)

const emit = (value: Record<string, unknown>) => console.info(`TA08 ${JSON.stringify(value)}`)

function refuseOutsideHarness(): void {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_TRADE_A_ACCEPTANCE_DB
  const profile = resolveNativeCheckoutEnvironment({
    node: process.env.NODE_ENV,
    baobab: process.env.BAOBAB_ENVIRONMENT,
    deployment: process.env.BAOBAB_DEPLOYMENT_ENV,
  })
  if (
    process.env.BAOBAB_TRADE_A_ACCEPTANCE !== "true" ||
    profile.production ||
    !expected ||
    !url ||
    new URL(url).pathname !== `/${expected}`
  )
    throw new Error("Trade-A acceptance runs only inside the marked TA-08 harness database")
}

export default async function acceptanceTradeA({ container, args }: ExecArgs) {
  refuseOutsideHarness()
  const [command, id] = args ?? []
  const regions = container.resolve<IRegionModuleService>(Modules.REGION)
  const channels = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)

  const scope = async () => {
    const uganda = findByCountryCode(
      await regions.listRegions({}, { relations: ["countries"] }),
      "UG",
    )
    const channel = findByMetadataKey(
      await channels.listSalesChannels({}),
      "baobab_sales_channel_key",
      "thamani_b2c",
    )
    const [product] = await products.listProducts(
      { handle: "thamani-instant-coffee-200g" },
      { relations: ["variants"] },
    )
    const variant = product?.variants?.[0]
    const sku = variant?.sku
    if (!uganda || !channel || !product || !variant || !sku)
      throw new Error("Run the Thamani market, catalogue and fulfilment bootstraps first")
    return { uganda, channel, product, variant, sku }
  }

  switch (command) {
    case "fixture": {
      const { uganda, channel, product, sku } = await scope()
      const locations = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
      const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
      const thamani = container.resolve<ThamaniModuleService>("thamani")
      const location = findByMarketKey(await locations.listStockLocations({}), "thamani_ug")
      if (!location) throw new Error("Run the Thamani inventory bootstrap first")
      const [item] = await inventory.listInventoryItems({ sku })
      const [level] = item
        ? await inventory.listInventoryLevels({
            inventory_item_id: item.id,
            location_id: location.id,
          })
        : []
      if (item && !level)
        await createInventoryLevelsWorkflow(container).run({
          input: {
            inventory_levels: [
              { inventory_item_id: item.id, location_id: location.id, stocked_quantity: 1000 },
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
      const {
        result: [key],
      } = await createApiKeysWorkflow(container).run({
        input: {
          api_keys: [{ title: `TA-08 ${randomUUID()}`, type: "publishable", created_by: "ta08" }],
        },
      })
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: key.id, add: [channel.id] },
      })
      return emit({
        region_id: uganda.id,
        sales_channel_id: channel.id,
        currency: "UGX",
        publishable_key: key.token,
      })
    }
    case "cart": {
      const { uganda, channel, variant } = await scope()
      const fulfillment = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
      const payments = container.resolve<IPaymentModuleService>(Modules.PAYMENT)
      const [shipping] = await fulfillment.listShippingOptions({
        name: "Thamani Uganda Standard Shipping (development placeholder rate)",
      })
      if (!shipping) throw new Error("Run the Thamani fulfilment bootstrap first")
      const { result: cart } = await createCartWorkflow(container).run({
        input: {
          region_id: uganda.id,
          sales_channel_id: channel.id,
          items: [{ variant_id: variant.id, quantity: 1 }],
          email: `ta08-${randomUUID()}@example.invalid`,
        },
      })
      await addShippingMethodToCartWorkflow(container).run({
        input: { cart_id: cart.id, options: [{ id: shipping.id }] },
      })
      const { result: collection } = await createPaymentCollectionForCartWorkflow(container).run({
        input: { cart_id: cart.id },
      })
      await payments.createPaymentSession(collection.id, {
        provider_id: "pp_system_default",
        currency_code: cart.currency_code,
        amount: collection.amount ?? cart.total ?? 0,
        data: {},
      })
      return emit({ cart_id: cart.id })
    }
    case "draft": {
      const { uganda, channel, product, variant } = await scope()
      // As the TA-07 regression builds it: Medusa's input type omits the draft flags.
      const input = {
        region_id: uganda.id,
        sales_channel_id: channel.id,
        email: `ta08-draft-${randomUUID()}@example.invalid`,
        currency_code: "ugx",
        items: [{ variant_id: variant.id, quantity: 1, title: product.title, unit_price: 10000 }],
        is_draft_order: true,
        status: "draft" as const,
      }
      const { result: draft } = await createOrderWorkflow(container).run({ input })
      return emit({ draft_id: draft.id })
    }
    case "complete":
    case "finalize":
    case "create-order": {
      try {
        const result =
          command === "complete"
            ? (await completeCartWorkflow(container).run({ input: { id } })).result
            : command === "finalize"
              ? (await convertDraftOrderWorkflow(container).run({ input: { id } })).result
              : (
                  await createOrderWorkflow(container).run({
                    input: {
                      ...(await scope().then(({ uganda, channel }) => ({
                        region_id: uganda.id,
                        sales_channel_id: channel.id,
                      }))),
                      email: `ta08-direct-${randomUUID()}@example.invalid`,
                      currency_code: "ugx",
                      items: [{ title: "TA-08 direct", quantity: 1, unit_price: 10000 }],
                    },
                  })
                ).result
        return emit({ ok: true, order_id: result.id })
      } catch (error) {
        return emit({ ok: false, message: messageOf(error) })
      }
    }
    case "posture": {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
      try {
        const reader = new PostgresPersistencePostureReader({
          connect: async () => {
            const client = await pool.connect()
            return {
              query: (sql, values) => client.query(sql, values ? [...values] : []),
              release: () => client.release(),
            }
          },
        })
        return emit({ ...(await reader.verify()) })
      } finally {
        await pool.end()
      }
    }
    default:
      throw new Error(`unknown Trade-A acceptance command: ${command}`)
  }
}
