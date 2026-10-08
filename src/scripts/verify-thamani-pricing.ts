import { QueryContext } from "@medusajs/framework/utils"
import type {
  ExecArgs,
  IPricingModuleService,
  IProductModuleService,
  RemoteQueryFunction,
} from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  isSaleActive,
  salePriceListKey,
  THAMANI_SALES,
} from "../baobab/thamani/pricing/sale-config"
import {
  ThamaniMarketCurrencyMismatchError,
  ThamaniProductNotEligibleForMarketError,
  toThamaniPricingDecision,
} from "../baobab/thamani/pricing/decision-port"
import { MedusaThamaniPricingDecisionPort } from "../baobab/thamani/pricing/medusa-adapter"
import { findByMetadataKey } from "../baobab/market/mapping"
import type ThamaniModuleService from "../modules/thamani/service"

export default async function verifyThamaniPricing({ container }: ExecArgs): Promise<void> {
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const pricingService = container.resolve<IPricingModuleService>(Modules.PRICING)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const priceLists = await pricingService.listPriceLists({})
  for (const sale of THAMANI_SALES) {
    const key = salePriceListKey(sale.windowKind)
    const priceList = findByMetadataKey(priceLists, "baobab_price_list_key", key)
    if (!priceList) throw new Error(`Expected sale Price List "${key}" to exist`)

    const now = Date.now()
    const startsAt = priceList.starts_at ? new Date(priceList.starts_at).getTime() : null
    const endsAt = priceList.ends_at ? new Date(priceList.ends_at).getTime() : null
    const windowCoversNow = startsAt !== null && endsAt !== null && startsAt <= now && now <= endsAt
    if (windowCoversNow !== isSaleActive(sale.windowKind)) {
      throw new Error(
        `Price List "${key}" window covering now=${windowCoversNow} does not match expected active=${isSaleActive(sale.windowKind)}`,
      )
    }

    const [product] = await productService.listProducts(
      { handle: sale.productHandle },
      { relations: ["variants"] },
    )
    const variant = product?.variants?.[0]
    if (!variant) throw new Error(`Product "${sale.productHandle}" is missing its variant`)

    for (const price of sale.prices) {
      const { data } = await query.graph({
        entity: "variants",
        fields: ["id", "calculated_price.*"],
        filters: { id: [variant.id] },
        context: { calculated_price: QueryContext({ currency_code: price.currencyCode }) },
      })
      const calculated = data[0]?.calculated_price
      const decision = toThamaniPricingDecision(
        { variantId: variant.id, marketKey: "thamani_ug", currencyCode: price.currencyCode },
        calculated ?? { calculated_amount: null, original_amount: null, currency_code: null },
      )

      if (isSaleActive(sale.windowKind)) {
        if (decision.kind !== "SALE") {
          throw new Error(
            `Expected ${sale.productHandle} to resolve a SALE price in ${price.currencyCode} while its window is active, got ${decision.kind}`,
          )
        }
        if (decision.amount !== price.saleAmount) {
          throw new Error(
            `Expected ${sale.productHandle} sale amount ${price.saleAmount} in ${price.currencyCode}, got ${decision.amount}`,
          )
        }
      } else if (decision.kind !== "STANDARD_RETAIL") {
        throw new Error(
          `Expected ${sale.productHandle} to resolve STANDARD_RETAIL in ${price.currencyCode} while its ${sale.windowKind} sale window does not cover now, got ${decision.kind}`,
        )
      }
    }
  }

  await verifyPricingDecisionPortFailsClosed(container, productService)

  container.resolve("logger").info("Verified Gate 8 Thamani B2C sale pricing and effective dating")
}

/**
 * Regression for a review finding on the merged Gate 8 PR: the pricing
 * decision port must not resolve a price for a Market/currency the launch
 * config does not authorize, and must not resolve a price for a Market the
 * variant's product is not eligible for — even though Gate 6 gives every
 * variant, including the deliberately single-Market fixtures, both a UGX
 * and a ZAR price. Both failures must be closed (throw), not silently
 * return an unauthorized price.
 */
async function verifyPricingDecisionPortFailsClosed(
  container: ExecArgs["container"],
  productService: IProductModuleService,
): Promise<void> {
  const query = container.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.QUERY)
  const thamani = container.resolve<ThamaniModuleService>("thamani")
  const port = new MedusaThamaniPricingDecisionPort(query, thamani)

  const [ugOnlyProduct] = await productService.listProducts(
    { handle: "thamani-reusable-cotton-tote-bag" },
    { relations: ["variants"] },
  )
  const ugOnlyVariant = ugOnlyProduct?.variants?.[0]
  if (!ugOnlyVariant) throw new Error("thamani-reusable-cotton-tote-bag is missing its variant")

  // Uganda only permits UGX — this SKU also carries a ZAR price (Gate 6
  // gives every variant both currencies), so nothing but this guard stops
  // an unauthorized thamani_ug/ZAR price from resolving.
  try {
    await port.decide({ variantId: ugOnlyVariant.id, marketKey: "thamani_ug", currencyCode: "zar" })
    throw new Error(
      "Expected a Market/currency mismatch (thamani_ug requested in zar) to fail closed",
    )
  } catch (error) {
    if (!(error instanceof ThamaniMarketCurrencyMismatchError)) throw error
  }

  // This SKU is Uganda-only (no thamani_za eligibility record). ZAR is a
  // currency South Africa does authorize, so only the eligibility check —
  // not the currency check — can catch this.
  try {
    await port.decide({ variantId: ugOnlyVariant.id, marketKey: "thamani_za", currencyCode: "zar" })
    throw new Error(
      "Expected a Uganda-only product requested for thamani_za to fail closed on eligibility",
    )
  } catch (error) {
    if (!(error instanceof ThamaniProductNotEligibleForMarketError)) throw error
  }

  // Gate 14 fail-closed compliance (see `ensureRetailProjection` in
  // bootstrap-thamani-catalogue.ts) withholds every product's Market
  // eligibility until its HS classification is VERIFIED, and the launch
  // catalogue's profiles are all deliberately UNVERIFIED illustrative
  // fixtures — so even this Market/currency-authorized combination must
  // still fail closed on eligibility today.
  // `regression-thamani-trade-compliance-gate.ts` proves this resolves
  // normally once a profile is genuinely verified.
  try {
    await port.decide({ variantId: ugOnlyVariant.id, marketKey: "thamani_ug", currencyCode: "ugx" })
    throw new Error(
      "Expected thamani-reusable-cotton-tote-bag to fail closed on eligibility pending Gate 14 review",
    )
  } catch (error) {
    if (!(error instanceof ThamaniProductNotEligibleForMarketError)) throw error
  }
}
