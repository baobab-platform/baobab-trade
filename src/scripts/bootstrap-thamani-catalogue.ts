import { createProductsWorkflow } from "@medusajs/core-flows"
import type {
  ExecArgs,
  IFulfillmentModuleService,
  IProductModuleService,
  ISalesChannelModuleService,
  Logger,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  THAMANI_CATALOGUE,
  THAMANI_CATEGORY_COUNTS,
  type ThamaniProductCategory,
  type ThamaniProductConfig,
} from "../baobab/thamani/catalogue"
import { THAMANI_SUPPLIERS } from "../baobab/thamani/suppliers"
import { deriveActiveEligibleMarketKeys } from "../baobab/thamani/search/projection"
import { requireVerifiedTradeProfile } from "../baobab/thamani/trade-readiness"
import { findByMetadataKey } from "../baobab/market/mapping"
import type ThamaniModuleService from "../modules/thamani/service"
import type TradeReadinessModuleService from "../modules/trade-readiness/service"

/**
 * The subset of catalogue configuration the `thamani_product` search index
 * (Gate 7) reads back off the product's native `metadata` rather than
 * joining to the `thamani` module's own tables — see
 * `src/baobab/thamani/search/projection.ts`.
 *
 * `activeMarketKeys` must come from the `thamani` module's own
 * `MarketProductEligibility` rows, not from `config.eligibleMarkets`: those
 * rows, not the static catalogue config, are the authority for eligibility,
 * and a row a later process suspends or withdraws must narrow this field.
 */
function searchProjectionMetadata(
  config: ThamaniProductConfig,
  activeMarketKeys: readonly string[],
): Record<string, unknown> {
  return {
    baobab_canonical_product_key: config.canonicalKey,
    baobab_catalogue: "thamani_b2c",
    thamani_category: config.category,
    thamani_brand: config.brand,
    thamani_country_of_origin: config.countryOfOrigin,
    thamani_supplier_key: config.supplierKey,
    thamani_consumer_uom: config.consumerUom,
    thamani_eligible_markets: [...activeMarketKeys],
  }
}

const CATEGORY_TITLES: Record<ThamaniProductCategory, string> = {
  COFFEE_TEA: "Coffee & Tea",
  CHOCOLATE_CONFECTIONERY: "Chocolate & Confectionery",
  SPICES_SEASONINGS: "Spices & Seasonings",
  PANTRY_STAPLES: "Pantry Staples",
  NATURAL_FOODS: "Natural Foods",
  PERSONAL_CARE: "Personal Care",
  HOUSEHOLD: "Household",
  LIFESTYLE: "Lifestyle",
}

async function ensureCategories(
  productService: IProductModuleService,
): Promise<Map<ThamaniProductCategory, string>> {
  const categoryIdByKey = new Map<ThamaniProductCategory, string>()
  for (const category of Object.keys(THAMANI_CATEGORY_COUNTS) as ThamaniProductCategory[]) {
    const title = CATEGORY_TITLES[category]
    const [existing] = await productService.listProductCategories({ name: title })
    const record =
      existing ??
      (await productService.createProductCategories({
        name: title,
        is_active: true,
        metadata: { baobab_catalogue: "thamani_b2c", thamani_category: category },
      }))
    categoryIdByKey.set(category, record.id)
  }
  return categoryIdByKey
}

async function ensureSuppliers(thamani: ThamaniModuleService): Promise<Map<string, string>> {
  const supplierIdByKey = new Map<string, string>()
  for (const config of THAMANI_SUPPLIERS) {
    const [existing] = await thamani.listSuppliers({ supplier_key: config.supplierKey })
    const supplier =
      existing ??
      (await thamani.createSuppliers({
        supplier_key: config.supplierKey,
        name: config.name,
        category: config.category,
        origin_country: config.originCountry,
        synthetic: config.synthetic,
        erp_business_partner_reference: null,
        status: "ACTIVE",
      }))
    supplierIdByKey.set(config.supplierKey, supplier.id)
  }
  return supplierIdByKey
}

async function ensureRetailProjection(
  thamani: ThamaniModuleService,
  tradeReadiness: TradeReadinessModuleService,
  logger: Logger,
  productId: string,
  supplierIdByKey: Map<string, string>,
  config: ThamaniProductConfig,
): Promise<void> {
  const supplierId = supplierIdByKey.get(config.supplierKey)
  if (!supplierId) throw new Error(`Unresolved supplier for ${config.sku}`)

  const [profile] = await thamani.listProductRetailProfiles({ product_id: productId })
  if (!profile) {
    await thamani.createProductRetailProfiles({
      product_id: productId,
      canonical_product_key: config.canonicalKey,
      supplier_id: supplierId,
      country_of_origin: config.countryOfOrigin,
      hs_classification_reference: config.hsClassificationReference,
      customs_category: config.customsCategory,
      product_tax_category: config.productTaxCategory,
      brand: config.brand,
      net_weight_kg: config.netWeightKg,
      gross_weight_kg: config.grossWeightKg,
      packaging: config.packaging,
      trade_uom: config.tradeUom,
      consumer_uom: config.consumerUom,
      food_attributes: config.foodAttributes ?? null,
    })
  }

  for (const marketKey of config.eligibleMarkets) {
    // Gate 14 fail-closed compliance: a product only stays sellable in a
    // Market while its HS classification is actually verified. This is the
    // ONLY enforcement point — no ACTIVE eligibility row is ever created (so
    // nothing downstream ever treats the product as eligible, see
    // `deriveActiveEligibleMarketKeys`) without a verified `ThamaniTradeProfile`
    // for this product/Market pair.
    const [tradeProfile] = await tradeReadiness.listThamaniTradeProfiles({
      canonical_product_key: config.canonicalKey,
      market_key: marketKey,
    })
    let isVerified = true
    try {
      requireVerifiedTradeProfile({
        hsClassificationStatus: tradeProfile?.hs_classification_status ?? "UNVERIFIED",
      })
    } catch (error) {
      isVerified = false
      logger.warn(
        `${marketKey} eligibility for ${config.sku} requires customs review: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    const policyReference = `control-plane:${marketKey}:catalogue`
    const [eligibility] = await thamani.listMarketProductEligibilities({
      product_id: productId,
      market_key: marketKey,
    })

    if (!eligibility) {
      if (isVerified) {
        await thamani.createMarketProductEligibilities({
          product_id: productId,
          market_key: marketKey,
          status: "ACTIVE",
          policy_reference: policyReference,
        })
      }
      continue
    }

    // A row this same catalogue-onboarding process created earlier — before
    // this gate existed, before its trade profile was revoked, or before a
    // once-revoked profile was re-verified — must be reconciled to the
    // current verification state, not left however it was found just
    // because it already exists.
    //
    // `WITHDRAWN` is used (not `SUSPENDED`) specifically because it is the
    // one status this bootstrap ever writes for compliance reasons — never
    // for anything else — so reconciling a `WITHDRAWN` row back to `ACTIVE`
    // on reverification can never be undoing someone else's decision.
    // `SUSPENDED` is left alone in both directions: it is reserved for a
    // different authority (e.g. a manual, non-compliance suspension —
    // `regression-thamani-eligibility-sync.ts` proves this exact case), and
    // this bootstrap must never reactivate a row it did not itself demote.
    if (eligibility.policy_reference !== policyReference) continue
    if (!isVerified && eligibility.status === "ACTIVE") {
      await thamani.updateMarketProductEligibilities({ id: eligibility.id, status: "WITHDRAWN" })
      logger.warn(`Withdrew ${marketKey} eligibility for ${config.sku}: no longer verified`)
    } else if (isVerified && eligibility.status === "WITHDRAWN") {
      await thamani.updateMarketProductEligibilities({ id: eligibility.id, status: "ACTIVE" })
      logger.info(`Reactivated ${marketKey} eligibility for ${config.sku}: verification restored`)
    }
  }
}

export default async function bootstrapThamaniCatalogue({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve("logger")
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const salesChannelService = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const fulfillmentService = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
  const thamani = container.resolve<ThamaniModuleService>("thamani")
  const tradeReadiness = container.resolve<TradeReadinessModuleService>("tradeReadiness")

  const salesChannels = await salesChannelService.listSalesChannels({})
  const salesChannel = findByMetadataKey(salesChannels, "baobab_sales_channel_key", "thamani_b2c")
  if (!salesChannel)
    throw new Error("Run bootstrap:thamani-market before bootstrap:thamani-catalogue")

  let [shippingProfile] = await fulfillmentService.listShippingProfiles({ type: "default" })
  if (!shippingProfile) {
    shippingProfile = await fulfillmentService.createShippingProfiles({
      name: "Thamani retail goods",
      type: "default",
    })
  }

  const categoryIdByKey = await ensureCategories(productService)
  const supplierIdByKey = await ensureSuppliers(thamani)

  let created = 0
  for (const config of THAMANI_CATALOGUE) {
    let [product] = await productService.listProducts(
      { handle: config.handle },
      { relations: ["variants"] },
    )
    if (!product) {
      const categoryId = categoryIdByKey.get(config.category)
      if (!categoryId) throw new Error(`Unresolved category for ${config.sku}`)

      const { result } = await createProductsWorkflow(container).run({
        input: {
          products: [
            {
              title: config.title,
              handle: config.handle,
              status: "published",
              description: `${config.title} — Thamani consumer retail.`,
              shipping_profile_id: shippingProfile.id,
              sales_channels: [{ id: salesChannel.id }],
              category_ids: [categoryId],
              options: [{ title: "Pack", values: [config.consumerUom] }],
              variants: [
                {
                  title: `${config.title} (${config.consumerUom})`,
                  sku: config.sku,
                  options: { Pack: config.consumerUom },
                  manage_inventory: true,
                  allow_backorder: false,
                  weight: config.grossWeightKg * 1000,
                  hs_code: config.hsClassificationReference,
                  origin_country: config.countryOfOrigin,
                  prices: config.prices.map((price) => ({
                    currency_code: price.currencyCode,
                    amount: price.standardAmount,
                  })),
                },
              ],
              // Initial value only: eligibility rows don't exist until
              // ensureRetailProjection runs just below, so this can only
              // seed from config. The refresh after it is authoritative.
              metadata: searchProjectionMetadata(config, config.eligibleMarkets),
            },
          ],
        },
      })
      product = result[0]
      created += 1
    }

    const variant = product.variants?.[0]
    if (!variant) throw new Error(`Product ${config.handle} has no retail variant`)
    await ensureRetailProjection(
      thamani,
      tradeReadiness,
      logger,
      product.id,
      supplierIdByKey,
      config,
    )

    // Keep the Gate 7 search-projection metadata in sync on every run, not
    // just at creation: search reads from `metadata`, never from the
    // `thamani` module's own tables, so both a catalogue change and a
    // direct eligibility-status change must reach it here. Eligibility is
    // read fresh from `thamani`'s own records — the authority — rather than
    // assumed from `config.eligibleMarkets`.
    const eligibilityRows = await thamani.listMarketProductEligibilities({
      product_id: product.id,
    })
    const activeMarketKeys = deriveActiveEligibleMarketKeys(eligibilityRows)
    await productService.updateProducts(product.id, {
      metadata: { ...product.metadata, ...searchProjectionMetadata(config, activeMarketKeys) },
    })
  }

  logger.info(
    `Bootstrapped ${THAMANI_CATALOGUE.length} Thamani B2C retail products (${created} newly created) across ${supplierIdByKey.size} suppliers`,
  )
}
