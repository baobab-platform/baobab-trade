import type { ExecArgs } from "@medusajs/framework/types"
import { ZURIBEANS_FULFILMENT_POLICIES } from "../baobab/fulfilment"
import type FulfilmentBridgeModuleService from "../modules/fulfilment-bridge/service"
export default async function ({ container }: ExecArgs) {
  const bridge = container.resolve<FulfilmentBridgeModuleService>("fulfilmentBridge")
  for (const policy of ZURIBEANS_FULFILMENT_POLICIES) {
    const [existing] = await bridge.listFulfilmentPolicyBindings({ market_key: policy.marketKey })
    if (!existing)
      await bridge.createFulfilmentPolicyBindings({
        market_key: policy.marketKey,
        country_code: policy.countryCode,
        legal_seller_key: policy.legalSellerKey,
        provider_bindings: policy.providers.map((provider) => ({ ...provider })),
        status: "ACTIVE",
      })
  }
  container.resolve("logger").info("Bootstrapped Gate 9 fulfilment policies")
}
