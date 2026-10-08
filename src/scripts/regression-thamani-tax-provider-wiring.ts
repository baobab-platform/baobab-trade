/**
 * DANGER — THIS SCRIPT MUTATES LIVE DATA. It creates disposable test Carts
 * in the Thamani Uganda Sales Channel via Medusa's own `createCartWorkflow`
 * — which calls `updateTaxLinesWorkflow.runAsStep(...)` inline while
 * building the cart, exactly the same tax-calculation path a real
 * add-to-cart request goes through — and asserts the resulting tax lines,
 * then deletes every Cart (and the disposable eligibility rows) it created.
 *
 * A review found Gate 13's real tax logic (`EffectiveDatedTaxProviderAdapter`
 * / `THAMANI_STANDARD_TAX_RULES`) was only ever exercised by bootstrap/verify
 * scripts, never by any real cart — Medusa's own Tax module computed 0% on
 * every cart because no `tax_rate` row is ever seeded (see
 * `provisioning.ts`). `ThamaniTaxProviderService`
 * (`src/modules/thamani-tax-provider/`) and the `setTaxLineContext` hook it
 * depends on (`src/workflows/thamani-tax-guard.ts`) close that gap; this
 * script proves the wiring is genuine, not just unit-tested in isolation:
 *
 *   1. A STANDARD-classified Thamani item resolves an 18% VAT tax line from
 *      this provider on a real cart, not Medusa's default 0%.
 *   2. A ZERO_RATED-classified item — a real, acknowledged gap, since only
 *      STANDARD GOODS rules have been sourced so far — fails closed
 *      (throws) rather than silently charging an invented rate.
 *   3. A ZuriBeans cart in the same shared Tax Region is unaffected: its
 *      item still resolves whatever Medusa's native rate-matching produces
 *      (0%, since no `tax_rate` row exists for it either), proving this
 *      provider changes nothing for the other Digital Estate.
 *
 * `thamani-cart-eligibility-guard.ts` (a separate Gate 14 fix) rejects
 * adding any Thamani item with no ACTIVE Market eligibility before this
 * workflow ever reaches tax calculation — the launch catalogue's launch
 * profiles are all deliberately UNVERIFIED (see bootstrap-thamani-
 * catalogue.ts), so this script gives both test products a disposable
 * ACTIVE eligibility row of its own, scoped to this regression's own
 * `policy_reference` so it is never mistaken for a real one.
 */
import { createCartWorkflow, createInventoryLevelsWorkflow } from "@medusajs/core-flows"
import type {
  ExecArgs,
  ICartModuleService,
  IInventoryService,
  IProductModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { findByCountryCode, findByMarketKey, findByMetadataKey } from "../baobab/market/mapping"
import ThamaniTaxProviderService from "../modules/thamani-tax-provider/service"
import type ThamaniModuleService from "../modules/thamani/service"

const REGRESSION_POLICY_REFERENCE = "regression:thamani-tax-provider-wiring"

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
 * An error thrown *inside* a workflow step (here, the provider's fail-closed
 * throw) crosses Medusa's transaction-orchestrator boundary on its way back
 * to `.run()`'s caller — it comes out the other side as a plain object
 * (`constructor.name === "Object"`, `instanceof Error` no longer matches),
 * not the original error instance. `.message` survives intact as an own-
 * enumerable field, so check that directly rather than `instanceof Error`.
 */
const errorMessage = (error: unknown): string =>
  typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error)

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

type CartItemTaxLine = { rate: number; code: string | null; provider_id: string }
type CartWithItemTaxLines = { items?: readonly { tax_lines?: readonly CartItemTaxLine[] }[] }

async function readFirstItemTaxLines(
  container: ExecArgs["container"],
  cartId: string,
): Promise<readonly CartItemTaxLine[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "items.tax_lines.rate", "items.tax_lines.code", "items.tax_lines.provider_id"],
    filters: { id: [cartId] },
  })
  const cart = data[0] as CartWithItemTaxLines | undefined
  return cart?.items?.[0]?.tax_lines ?? []
}

export default async function regressionThamaniTaxProviderWiring({
  container,
}: ExecArgs): Promise<void> {
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const regionService = container.resolve<IRegionModuleService>(Modules.REGION)
  const salesChannelService = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const cartService = container.resolve<ICartModuleService>(Modules.CART)
  const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
  const stockLocationService = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const thamani = container.resolve<ThamaniModuleService>("thamani")

  const regions = await regionService.listRegions({}, { relations: ["countries"] })
  const ugandaRegion = findByCountryCode(regions, "UG")
  if (!ugandaRegion)
    throw new Error("No Region provisioned for Uganda — run bootstrap:market first")

  const salesChannels = await salesChannelService.listSalesChannels({})
  const thamaniSalesChannel = findByMetadataKey(
    salesChannels,
    "baobab_sales_channel_key",
    "thamani_b2c",
  )
  if (!thamaniSalesChannel) throw new Error("Run bootstrap:thamani-market before this regression")
  const zuribeansSalesChannel = findByMetadataKey(
    salesChannels,
    "baobab_sales_channel_key",
    "zuribeans_b2b",
  )
  if (!zuribeansSalesChannel) throw new Error("Run bootstrap:market before this regression")

  const stockLocations = await stockLocationService.listStockLocations({})
  const thamaniUgandaStockLocation = findByMarketKey(stockLocations, "thamani_ug")
  if (!thamaniUgandaStockLocation)
    throw new Error("No Thamani Uganda stock location — run bootstrap:thamani-market first")
  const zuribeansUgandaStockLocation = findByMarketKey(stockLocations, "zuribeans_ug")
  if (!zuribeansUgandaStockLocation)
    throw new Error("No ZuriBeans Uganda stock location — run bootstrap:market first")

  // STANDARD-classified: real, sourced 18% Uganda VAT.
  const standardVariant = await resolveVariant(productService, "thamani-instant-coffee-200g")
  await ensureInventoryLevel(
    container,
    inventoryService,
    standardVariant.sku,
    thamaniUgandaStockLocation.id,
  )
  // ZERO_RATED-classified: no rule sourced yet, must fail closed.
  const zeroRatedVariant = await resolveVariant(productService, "thamani-white-rice-2kg")
  await ensureInventoryLevel(
    container,
    inventoryService,
    zeroRatedVariant.sku,
    thamaniUgandaStockLocation.id,
  )
  // An unfiltered listProducts({}) would risk resolving a Thamani product
  // instead — both estates' products live in the same Product module table.
  const zuribeansItemVariant = await resolveVariant(
    productService,
    "uganda-arabica-green-coffee-aa",
  )
  await ensureInventoryLevel(
    container,
    inventoryService,
    zuribeansItemVariant.sku,
    zuribeansUgandaStockLocation.id,
  )

  const cartIds: string[] = []
  try {
    // `thamani-cart-eligibility-guard.ts` (a separate Gate 14 fix) rejects
    // adding either test item to a cart at all unless it already has an
    // ACTIVE Market eligibility — neither does, since nothing in the launch
    // catalogue is verified yet. Give both a disposable one of this
    // regression's own, scoped to a `policy_reference` that can never be
    // mistaken for a real product's. Inside the try so a failure partway
    // through (e.g. the second call finding an unexpected pre-existing row)
    // still reaches the `finally` cleanup for whichever one did get created.
    await ensureDisposableEligibility(thamani, standardVariant.productId, "thamani_ug")
    await ensureDisposableEligibility(thamani, zeroRatedVariant.productId, "thamani_ug")

    const { result: thamaniCart } = await createCartWorkflow(container).run({
      input: {
        region_id: ugandaRegion.id,
        sales_channel_id: thamaniSalesChannel.id,
        items: [{ variant_id: standardVariant.id, quantity: 1 }],
      },
    })
    cartIds.push(thamaniCart.id)
    const thamaniTaxLines = await readFirstItemTaxLines(container, thamaniCart.id)
    if (thamaniTaxLines.length !== 1 || thamaniTaxLines[0].rate !== 18) {
      throw new Error(
        `Expected a single 18% Thamani Uganda VAT tax line, got ${JSON.stringify(thamaniTaxLines)}`,
      )
    }
    if (thamaniTaxLines[0].provider_id !== ThamaniTaxProviderService.identifier) {
      throw new Error(
        `Expected the tax line's provider to be ${ThamaniTaxProviderService.identifier}, got ${thamaniTaxLines[0].provider_id}`,
      )
    }

    let zeroRatedRejected = false
    try {
      const { result: zeroRatedCart } = await createCartWorkflow(container).run({
        input: {
          region_id: ugandaRegion.id,
          sales_channel_id: thamaniSalesChannel.id,
          items: [{ variant_id: zeroRatedVariant.id, quantity: 1 }],
        },
      })
      cartIds.push(zeroRatedCart.id)
    } catch (error) {
      if (!errorMessage(error).includes("No effective tax rule")) throw error
      zeroRatedRejected = true
    }
    if (!zeroRatedRejected) {
      throw new Error(
        "Expected a ZERO_RATED Thamani item (no sourced GOODS rule yet) to fail closed on tax calculation",
      )
    }

    const { result: zuribeansCart } = await createCartWorkflow(container).run({
      input: {
        region_id: ugandaRegion.id,
        sales_channel_id: zuribeansSalesChannel.id,
        items: [{ variant_id: zuribeansItemVariant.id, quantity: 1 }],
      },
    })
    cartIds.push(zuribeansCart.id)
    const zuribeansTaxLines = await readFirstItemTaxLines(container, zuribeansCart.id)
    if (
      zuribeansTaxLines.some((line) => line.provider_id === ThamaniTaxProviderService.identifier)
    ) {
      throw new Error(
        "Expected a ZuriBeans cart to never be classified by the Thamani tax provider's own rules",
      )
    }
  } finally {
    if (cartIds.length > 0) await cartService.deleteCarts(cartIds)
    const disposableEligibilities = await thamani.listMarketProductEligibilities({
      product_id: [standardVariant.productId, zeroRatedVariant.productId],
      market_key: "thamani_ug",
      policy_reference: REGRESSION_POLICY_REFERENCE,
    })
    if (disposableEligibilities.length) {
      await thamani.deleteMarketProductEligibilities(disposableEligibilities.map((e) => e.id))
    }
  }

  container
    .resolve("logger")
    .info(
      "Verified Thamani B2C tax provider wiring: real VAT on real carts, fail-closed for unsourced categories, and zero behaviour change for ZuriBeans",
    )
}
