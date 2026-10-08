import type { ExecArgs, IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { THAMANI_CATALOGUE } from "../baobab/thamani/catalogue"
import { THAMANI_SUPPLIERS } from "../baobab/thamani/suppliers"
import type ThamaniModuleService from "../modules/thamani/service"

export default async function verifyThamaniCatalogue({ container }: ExecArgs): Promise<void> {
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const thamani = container.resolve<ThamaniModuleService>("thamani")

  const products = await productService.listProducts(
    { handle: THAMANI_CATALOGUE.map((product) => product.handle) },
    { relations: ["variants", "categories"] },
  )
  if (products.length !== THAMANI_CATALOGUE.length) {
    throw new Error(
      `Expected ${THAMANI_CATALOGUE.length} Thamani products, found ${products.length}`,
    )
  }

  const [suppliers, profiles, eligibilities] = await Promise.all([
    thamani.listSuppliers({}),
    thamani.listProductRetailProfiles({ product_id: products.map((product) => product.id) }),
    thamani.listMarketProductEligibilities({ product_id: products.map((product) => product.id) }),
  ])

  if (suppliers.length !== THAMANI_SUPPLIERS.length) {
    throw new Error(`Expected ${THAMANI_SUPPLIERS.length} suppliers, found ${suppliers.length}`)
  }
  if (profiles.length !== THAMANI_CATALOGUE.length) {
    throw new Error(
      `Expected ${THAMANI_CATALOGUE.length} retail profiles, found ${profiles.length}`,
    )
  }

  // Gate 14 fail-closed compliance (see `ensureRetailProjection` in
  // bootstrap-thamani-catalogue.ts): a Market eligibility row is only ever
  // created once a product/Market pair's `ThamaniTradeProfile` has been
  // reviewed and marked VERIFIED. `bootstrap:thamani-trade-readiness` seeds
  // every profile as illustrative and deliberately UNVERIFIED, so nothing in
  // the launch catalogue is sellable yet — zero eligibility rows, for every
  // product, is the correct fail-closed outcome here, not a bug.
  // `regression-thamani-trade-compliance-gate.ts` proves the positive path
  // (a verified profile does unlock eligibility) against disposable fixtures.
  if (eligibilities.length !== 0) {
    throw new Error(
      `Expected 0 Market eligibility records pending Gate 14 review, found ${eligibilities.length}`,
    )
  }

  const ugOnlyProduct = products.find((p) => p.handle === "thamani-reusable-cotton-tote-bag")
  const zaOnlyProduct = products.find((p) => p.handle === "thamani-handcrafted-ceramic-mug")
  if (!ugOnlyProduct || !zaOnlyProduct) {
    throw new Error("Expected single-Market isolation SKUs are missing")
  }

  const categoryCount = new Set(products.flatMap((p) => p.categories?.map((c) => c.id) ?? [])).size
  if (categoryCount !== 8) {
    throw new Error(`Expected 8 Thamani product categories, found ${categoryCount}`)
  }

  container.resolve("logger").info("Verified Gate 6 Thamani B2C retail catalogue and suppliers")
}
