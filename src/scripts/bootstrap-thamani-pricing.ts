import { createPriceListsWorkflow, updatePriceListsWorkflow } from "@medusajs/core-flows"
import type {
  ExecArgs,
  IPricingModuleService,
  IProductModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  resolveSaleWindow,
  salePriceListKey,
  THAMANI_SALES,
  THAMANI_SALE_WINDOW_KINDS,
  type SaleWindowKind,
  type ThamaniSaleConfig,
} from "../baobab/thamani/pricing"
import { findByMetadataKey } from "../baobab/market/mapping"

async function resolveVariantId(
  productService: IProductModuleService,
  productHandle: string,
): Promise<string> {
  const [product] = await productService.listProducts(
    { handle: productHandle },
    { relations: ["variants"] },
  )
  const variant = product?.variants?.[0]
  if (!variant) {
    throw new Error(
      `No product/variant found for handle "${productHandle}" — run bootstrap:thamani-catalogue first`,
    )
  }
  return variant.id
}

/**
 * Idempotently provisions the three demonstration sale Price Lists (Gate 8:
 * effective-dated retail pricing), one per `SaleWindowKind`. `starts_at`/
 * `ends_at` are recomputed relative to *now* on every run, so a price list's
 * window never goes stale between bootstrap runs — an ACTIVE sale price list
 * stays active, an EXPIRED one stays expired, regardless of when this
 * script runs.
 *
 * `type` is deliberately not set on create: Medusa's Price List model
 * defaults it to `"sale"` (`PriceListType.SALE`), which is exactly what
 * `ThamaniPricingDecisionPort` classifies as a sale price.
 */
export default async function bootstrapThamaniPricing({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve("logger")
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const pricingService = container.resolve<IPricingModuleService>(Modules.PRICING)

  const salesByWindow = new Map<SaleWindowKind, ThamaniSaleConfig[]>()
  for (const sale of THAMANI_SALES) {
    const bucket = salesByWindow.get(sale.windowKind) ?? []
    bucket.push(sale)
    salesByWindow.set(sale.windowKind, bucket)
  }

  const now = new Date()
  let provisioned = 0

  for (const windowKind of THAMANI_SALE_WINDOW_KINDS) {
    const sales = salesByWindow.get(windowKind) ?? []
    if (sales.length === 0) continue

    const window = resolveSaleWindow(windowKind, now)
    const key = salePriceListKey(windowKind)

    const priceLists = await pricingService.listPriceLists({})
    const existing = findByMetadataKey(priceLists, "baobab_price_list_key", key)

    if (!existing) {
      const variantEntries = await Promise.all(
        sales.map(async (sale) => ({
          sale,
          variantId: await resolveVariantId(productService, sale.productHandle),
        })),
      )

      const { result } = await createPriceListsWorkflow(container).run({
        input: {
          price_lists_data: [
            {
              title: `Thamani Seasonal Sale (${windowKind})`,
              description: `Gate 8 demonstration ${windowKind.toLowerCase()} sale window.`,
              status: "active",
              starts_at: window.startsAt.toISOString(),
              ends_at: window.endsAt.toISOString(),
              metadata: { baobab_price_list_key: key },
              prices: variantEntries.flatMap(({ sale: entry, variantId }) =>
                entry.prices.map((price) => ({
                  variant_id: variantId,
                  currency_code: price.currencyCode,
                  amount: price.saleAmount,
                })),
              ),
            },
          ],
        },
      })
      provisioned += 1
      logger.info(`Created ${windowKind} sale Price List ${result[0].id}`)
      continue
    }

    // Refresh the window on every run so it never drifts stale. The prices
    // themselves are set once at creation: THAMANI_SALES is a fixed, static
    // fixture, not a catalogue that changes independently of a deploy.
    await updatePriceListsWorkflow(container).run({
      input: {
        price_lists_data: [
          {
            id: existing.id,
            starts_at: window.startsAt.toISOString(),
            ends_at: window.endsAt.toISOString(),
          },
        ],
      },
    })
    logger.info(`Refreshed ${windowKind} sale Price List ${existing.id} window`)
  }

  logger.info(
    `Bootstrapped Thamani sale pricing across ${THAMANI_SALE_WINDOW_KINDS.length} window kinds (${provisioned} newly created)`,
  )
}
