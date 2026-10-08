import type { ExecArgs } from "@medusajs/framework/types"
import { ZURIBEANS_TAX_CONTEXTS } from "../baobab/tax"
import type TaxBridgeModuleService from "../modules/tax-bridge/service"
export default async function ({ container }: ExecArgs) {
  const bridge = container.resolve<TaxBridgeModuleService>("taxBridge")
  for (const context of ZURIBEANS_TAX_CONTEXTS) {
    const [existing] = await bridge.listTaxPolicyBindings({
      market_key: context.marketKey,
      legal_seller_key: context.legalSellerKey,
    })
    if (!existing)
      await bridge.createTaxPolicyBindings({
        market_key: context.marketKey,
        jurisdiction_key: context.jurisdictionKey,
        currency_code: context.currency,
        legal_seller_key: context.legalSellerKey,
        provider_key: context.providerKey,
        seller_registration_reference: context.sellerRegistrationReference,
        prices_include_tax: context.pricesIncludeTax,
        fail_closed: context.failClosed,
        status: "ACTIVE",
      })
  }
  container
    .resolve("logger")
    .info("Bootstrapped Gate 10 Uganda and South Africa tax contexts without statutory rates")
}
