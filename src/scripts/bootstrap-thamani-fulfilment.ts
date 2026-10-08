import type { ExecArgs } from "@medusajs/framework/types"
import { THAMANI_FULFILMENT_POLICIES } from "../baobab/thamani/fulfilment"
import type FulfilmentBridgeModuleService from "../modules/fulfilment-bridge/service"

export default async function ({ container }: ExecArgs) {
  const bridge = container.resolve<FulfilmentBridgeModuleService>("fulfilmentBridge")
  for (const policy of THAMANI_FULFILMENT_POLICIES) {
    const [existing] = await bridge.listFulfilmentPolicyBindings({ market_key: policy.marketKey })
    const input = {
      market_key: policy.marketKey,
      country_code: policy.countryCode,
      legal_seller_key: policy.legalSellerKey,
      provider_bindings: policy.providers.map((provider) => ({ ...provider })),
      status: "ACTIVE" as const,
    }
    if (existing) await bridge.updateFulfilmentPolicyBindings({ id: existing.id, ...input })
    else await bridge.createFulfilmentPolicyBindings(input)
  }
  container.resolve("logger").info("Bootstrapped Thamani Gate 12 fulfilment policies")
}
