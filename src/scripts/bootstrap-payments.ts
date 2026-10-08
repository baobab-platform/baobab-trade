import type { ExecArgs } from "@medusajs/framework/types"
import { ZURIBEANS_PAYMENT_POLICIES } from "../baobab/payments"
import type PaymentBridgeModuleService from "../modules/payment-bridge/service"

export default async function bootstrapPayments({ container }: ExecArgs): Promise<void> {
  const bridge = container.resolve<PaymentBridgeModuleService>("paymentBridge")
  for (const policy of ZURIBEANS_PAYMENT_POLICIES) {
    const [existing] = await bridge.listPaymentPolicyBindings({
      market_key: policy.marketKey,
      currency_code: policy.currency,
    })
    if (!existing) {
      await bridge.createPaymentPolicyBindings({
        market_key: policy.marketKey,
        legal_seller_key: policy.legalSellerKey,
        currency_code: policy.currency,
        default_terms: policy.defaultTerms,
        allowed_terms: [...policy.allowedTerms],
        provider_bindings: policy.providers.map((provider) => ({ ...provider })),
        status: "ACTIVE",
      })
    }
  }
  container
    .resolve("logger")
    .info("Bootstrapped Gate 8 payment policies for Uganda and South Africa")
}
