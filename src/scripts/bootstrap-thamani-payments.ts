import type { ExecArgs } from "@medusajs/framework/types"
import { THAMANI_PAYMENT_POLICIES } from "../baobab/thamani/payments"
import type PaymentBridgeModuleService from "../modules/payment-bridge/service"

export default async function bootstrapThamaniPayments({ container }: ExecArgs): Promise<void> {
  const bridge = container.resolve<PaymentBridgeModuleService>("paymentBridge")
  for (const policy of THAMANI_PAYMENT_POLICIES) {
    const [existing] = await bridge.listPaymentPolicyBindings({
      market_key: policy.marketKey,
      currency_code: policy.currency,
    })
    const input = {
      market_key: policy.marketKey,
      legal_seller_key: policy.legalSellerKey,
      currency_code: policy.currency,
      default_terms: policy.defaultTerms,
      allowed_terms: [...policy.allowedTerms],
      provider_bindings: policy.providers.map((provider) => ({ ...provider })),
      status: "ACTIVE" as const,
    }
    if (existing) await bridge.updatePaymentPolicyBindings({ id: existing.id, ...input })
    else await bridge.createPaymentPolicyBindings(input)
  }
  container.resolve("logger").info("Bootstrapped Thamani Gate 11 regional payment policies")
}
