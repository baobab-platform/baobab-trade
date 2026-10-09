/**
 * ADR-BCP-027 LA-05C2: Medusa's ACTUAL cart-completion workflow hook.
 *
 * Unlike the standalone order port, this hook executes before native order
 * creation. It remains opt-in for non-production staging; without a registered
 * server-owned binding resolver + current CP assessor + independent provider
 * readiness, every enabled completion FAILS CLOSED. There is deliberately no
 * dummy service, client-supplied legal actor, or fallback to tenant DEFAULT.
 *
 * Promotion to production requires completed LA-05 staging acceptance and a
 * separate audited implementation of the dependency registration.
 */
import { completeCartWorkflow } from "@medusajs/core-flows"
import {
  enforceNativeCheckoutGate,
  NATIVE_SELLER_DEPENDENCY_KEY,
  type NativeCartLegalSellerDependencies,
  type NativeCheckoutCart,
} from "../baobab/orders/native-cart-legal-seller"

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  await enforceNativeCheckoutGate(
    cart as NativeCheckoutCart,
    process.env.BAOBAB_LA05_NATIVE_CHECKOUT_GUARD === "true",
    process.env.NODE_ENV === "production",
    () => container.resolve<NativeCartLegalSellerDependencies>(NATIVE_SELLER_DEPENDENCY_KEY),
  )
})
