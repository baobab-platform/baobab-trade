import type {
  ExecArgs,
  IPricingModuleService,
  IProductModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { VOLUME_PRICE_LIST_KEY, ZURIBEANS_CATALOGUE } from "../baobab/catalogue"
import { findByMetadataKey } from "../baobab/market/mapping"
import type B2BModuleService from "../modules/b2b/service"

export default async function verifyCatalogue({ container }: ExecArgs): Promise<void> {
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const pricingService = container.resolve<IPricingModuleService>(Modules.PRICING)
  const b2b = container.resolve<B2BModuleService>("b2b")

  const products = await productService.listProducts(
    { handle: ZURIBEANS_CATALOGUE.map((product) => product.handle) },
    { relations: ["variants"] },
  )
  if (products.length !== ZURIBEANS_CATALOGUE.length) {
    throw new Error(`Expected 10 ZuriBeans products, found ${products.length}`)
  }

  const [profiles, eligibilities, constraints, priceLists] = await Promise.all([
    b2b.listProductTradeProfiles({ product_id: products.map((product) => product.id) }),
    b2b.listMarketProductEligibilities({ product_id: products.map((product) => product.id) }),
    b2b.listPurchaseConstraints({
      variant_id: products.flatMap(
        (product) => product.variants?.map((variant) => variant.id) ?? [],
      ),
    }),
    pricingService.listPriceLists({}, { relations: ["prices"] }),
  ])

  if (profiles.length !== 10)
    throw new Error(`Expected 10 trade profiles, found ${profiles.length}`)
  if (eligibilities.length !== 20) {
    throw new Error(`Expected 20 Market eligibility records, found ${eligibilities.length}`)
  }
  if (constraints.length !== 20) {
    throw new Error(`Expected 20 purchase constraints, found ${constraints.length}`)
  }

  const volumeList = findByMetadataKey(priceLists, "baobab_price_list_key", VOLUME_PRICE_LIST_KEY)
  if (!volumeList) throw new Error("ZuriBeans volume price list is missing")
  if (volumeList.prices?.length !== 40) {
    throw new Error(`Expected 40 volume prices, found ${volumeList.prices?.length ?? 0}`)
  }

  container.resolve("logger").info("Verified Gate 6 B2B catalogue and pricing projections")
}
