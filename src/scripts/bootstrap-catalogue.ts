import { createPriceListsWorkflow, createProductsWorkflow } from "@medusajs/core-flows"
import type {
  ExecArgs,
  IFulfillmentModuleService,
  IPricingModuleService,
  IProductModuleService,
  ISalesChannelModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  VOLUME_PRICE_LIST_KEY,
  ZURIBEANS_CATALOGUE,
  type ZuriBeansProductConfig,
} from "../baobab/catalogue"
import { findByMetadataKey } from "../baobab/market/mapping"
import type B2BModuleService from "../modules/b2b/service"

type CatalogueProjection = { productId: string; variantId: string; config: ZuriBeansProductConfig }

async function ensureTradeProjection(
  b2b: B2BModuleService,
  projection: CatalogueProjection,
): Promise<void> {
  const { productId, variantId, config } = projection
  const [profile] = await b2b.listProductTradeProfiles({ product_id: productId })
  if (!profile) {
    await b2b.createProductTradeProfiles({
      product_id: productId,
      canonical_product_key: config.canonicalKey,
      country_of_origin: "UG",
      hs_classification_reference: config.hsClassificationReference,
      commodity_category: config.commodityCategory,
      trade_uom: config.tradeUom,
      net_weight_kg: config.netWeightKg,
      gross_weight_kg: config.grossWeightKg,
      packaging: config.packaging,
      lot_controlled: config.lotControlled,
      batch_controlled: config.batchControlled,
      export_eligibility_reference: config.exportEligibilityReference,
      commodity_attributes: config.attributes,
    })
  }

  for (const marketKey of config.eligibleMarkets) {
    const [eligibility] = await b2b.listMarketProductEligibilities({
      product_id: productId,
      market_key: marketKey,
    })
    if (!eligibility) {
      await b2b.createMarketProductEligibilities({
        product_id: productId,
        market_key: marketKey,
        status: "ACTIVE",
        policy_reference: `control-plane:${marketKey}:catalogue`,
      })
    }

    const [constraint] = await b2b.listPurchaseConstraints({
      variant_id: variantId,
      market_key: marketKey,
    })
    if (!constraint) {
      await b2b.createPurchaseConstraints({
        variant_id: variantId,
        market_key: marketKey,
        minimum_order_quantity: config.minimumOrderQuantity,
        order_multiple: config.orderMultiple,
        trade_uom: config.tradeUom,
      })
    }
  }
}

export default async function bootstrapCatalogue({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve("logger")
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const salesChannelService = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const fulfillmentService = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
  const pricingService = container.resolve<IPricingModuleService>(Modules.PRICING)
  const b2b = container.resolve<B2BModuleService>("b2b")

  const salesChannels = await salesChannelService.listSalesChannels({})
  const salesChannel = findByMetadataKey(salesChannels, "baobab_sales_channel_key", "zuribeans_b2b")
  if (!salesChannel) throw new Error("Run bootstrap:market before bootstrap:catalogue")

  let [shippingProfile] = await fulfillmentService.listShippingProfiles({ type: "default" })
  if (!shippingProfile) {
    shippingProfile = await fulfillmentService.createShippingProfiles({
      name: "ZuriBeans physical goods",
      type: "default",
    })
  }

  const projections: CatalogueProjection[] = []
  for (const config of ZURIBEANS_CATALOGUE) {
    let [product] = await productService.listProducts(
      { handle: config.handle },
      { relations: ["variants"] },
    )
    if (!product) {
      const { result } = await createProductsWorkflow(container).run({
        input: {
          products: [
            {
              title: config.title,
              handle: config.handle,
              status: "published",
              description: `${config.title}, packed for business-to-business trade.`,
              shipping_profile_id: shippingProfile.id,
              sales_channels: [{ id: salesChannel.id }],
              options: [{ title: "Pack", values: [`${config.netWeightKg} kg`] }],
              variants: [
                {
                  title: `${config.netWeightKg} kg ${config.tradeUom.toLowerCase()}`,
                  sku: config.sku,
                  options: { Pack: `${config.netWeightKg} kg` },
                  manage_inventory: true,
                  allow_backorder: false,
                  weight: config.grossWeightKg * 1000,
                  hs_code: config.hsClassificationReference,
                  origin_country: "UG",
                  prices: config.prices.map((price) => ({
                    currency_code: price.currencyCode,
                    amount: price.standardAmount,
                  })),
                },
              ],
              metadata: {
                baobab_canonical_product_key: config.canonicalKey,
                baobab_catalogue: "zuribeans_b2b",
              },
            },
          ],
        },
      })
      product = result[0]
    }
    const variant = product.variants?.[0]
    if (!variant) throw new Error(`Product ${config.handle} has no trade variant`)
    const projection = { productId: product.id, variantId: variant.id, config }
    await ensureTradeProjection(b2b, projection)
    projections.push(projection)
  }

  const priceLists = await pricingService.listPriceLists({})
  const volumeList = findByMetadataKey(priceLists, "baobab_price_list_key", VOLUME_PRICE_LIST_KEY)
  if (!volumeList) {
    await createPriceListsWorkflow(container).run({
      input: {
        price_lists_data: [
          {
            title: "ZuriBeans B2B Volume Pricing",
            description: "Quantity-tier pricing for the principal ZuriBeans B2B catalogue",
            status: "active",
            metadata: { baobab_price_list_key: VOLUME_PRICE_LIST_KEY },
            prices: projections.flatMap(({ variantId, config }) =>
              config.prices.flatMap((price) =>
                price.volumeTiers.map((tier) => ({
                  variant_id: variantId,
                  currency_code: price.currencyCode,
                  amount: tier.amount,
                  min_quantity: tier.minQuantity,
                  max_quantity: tier.maxQuantity,
                })),
              ),
            ),
          },
        ],
      },
    })
  }

  logger.info(`Bootstrapped ${projections.length} ZuriBeans B2B product families`)
}
