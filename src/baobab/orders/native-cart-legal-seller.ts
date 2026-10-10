import type { LegalActorAssessmentPort } from "../control-plane/legal-actor-assessment"
import type { WorkloadTokenProvider } from "../control-plane/workload-token"
import {
  assertFreshSellerFact,
  type GovernedSellerOrderCommand,
  type LegalSellerProviderReadiness,
} from "./governed-legal-seller"

/**
 * LA-05C2: the native Medusa completeCartWorkflow guard uses only server-owned,
 * versioned cart bindings. Cart metadata, customer headers and storefront names
 * must NEVER choose the LegalEntity, Organisation or CP context.
 */
export type NativeCheckoutCart = {
  id?: string | null
  sales_channel_id?: string | null
  region_id?: string | null
}

export type NativeCartIdentity = {
  cartId: string
  salesChannelId: string | null
  regionId: string | null
}

export type TrustedNativeSellerBinding = GovernedSellerOrderCommand &
  NativeCartIdentity & { tenantId: string }

export interface TrustedNativeSellerBindingResolver {
  /** Must load authoritative server-side state; no browser-selected actor. */
  resolveForCart(cart: NativeCartIdentity): Promise<TrustedNativeSellerBinding>
}

export type NativeCartLegalSellerDependencies = {
  bindings: TrustedNativeSellerBindingResolver
  cp: LegalActorAssessmentPort
  tokens: WorkloadTokenProvider
  readiness: LegalSellerProviderReadiness
  now?: () => number
}

export const NATIVE_SELLER_DEPENDENCY_KEY = "baobab_native_seller_checkout_dependencies"

/**
 * Called by the REAL completeCartWorkflow validate hook, immediately before
 * Medusa's commit path. It cannot create an order or grant provider authority.
 */
export async function assertNativeCartLegalSeller(
  cart: NativeCheckoutCart,
  deps: NativeCartLegalSellerDependencies,
): Promise<void> {
  if (!cart?.id || typeof cart.id !== "string") {
    throw new Error("Native legal seller denied: no canonical cart ID")
  }
  if (!deps?.bindings || !deps.cp || !deps.tokens || !deps.readiness) {
    throw new Error("Native legal seller denied: required trusted dependencies unavailable")
  }
  const identity: NativeCartIdentity = {
    cartId: cart.id,
    salesChannelId: cart.sales_channel_id ?? null,
    regionId: cart.region_id ?? null,
  }
  const command = await deps.bindings.resolveForCart(identity)
  // The operation reference binds the current CP authority decision to THIS
  // native Medusa cart-completion attempt. Never accept a storefront order ID.
  if (
    !command ||
    command.cartId !== identity.cartId ||
    command.salesChannelId !== identity.salesChannelId ||
    command.regionId !== identity.regionId ||
    command.orderReference !== `cart/${identity.cartId}/complete` ||
    !command.tenantId ||
    !command.organisationId ||
    !command.legalContextId ||
    !command.legalSellerKey ||
    !command.legalActivity ||
    !command.legalCapability ||
    !command.correlationId ||
    !/^[A-Z]{2}$/.test(command.marketCode)
  ) {
    throw new Error("Native legal seller denied: no matching trusted cart binding")
  }
  const request = {
    context_id: command.legalContextId,
    role: "SELLER_OF_RECORD" as const,
    activity: command.legalActivity,
    market: command.marketCode,
    capability: command.legalCapability,
    operation_reference: command.orderReference,
  }
  const now = deps.now ?? Date.now
  const initial = assertFreshSellerFact(
    await deps.cp.assess(request, await deps.tokens.getAccessToken(), command.correlationId),
    command,
    now(),
  )
  // Native provider readiness is independent of CP's legal responsibility.
  await deps.readiness.assertReadyForSeller(command, initial)
  // LA-05C4: a local cart binding may be revoked, expire, or be replaced
  // WHILE the provider is assessed. Re-read the server-owned row and fresh CP
  // market attestation before the final CP mandate assessment.
  const currentBinding = await deps.bindings.resolveForCart(identity)
  const immutableSellerScope = [
    "cartId",
    "salesChannelId",
    "regionId",
    "tenantId",
    "organisationId",
    "legalContextId",
    "legalSellerKey",
    "marketCode",
    "marketKey",
    "currencyCode",
    "legalActivity",
    "legalCapability",
    "orderReference",
    "correlationId",
    "idempotencyKey",
  ] as const
  if (
    !currentBinding ||
    immutableSellerScope.some((field) => currentBinding[field] !== command[field])
  ) {
    throw new Error("Native legal seller denied: cart binding changed or revoked during readiness")
  }
  // Do not commit using the pre-readiness authority (revocation race).
  const final = assertFreshSellerFact(
    await deps.cp.assess(request, await deps.tokens.getAccessToken(), command.correlationId),
    command,
    now(),
  )
  if (
    final.mandateId !== initial.mandateId ||
    final.responsibleLegalEntityId !== initial.responsibleLegalEntityId
  ) {
    throw new Error("Native legal seller denied: mandate changed before commit")
  }
}

/**
 * Default off; even explicit enabling does not create an operational provider.
 * A missing/trusted-dependency registration must DENY, never fall back to
 * Medusa's ungoverned seller/tenant defaults.
 */
export async function enforceNativeCheckoutGate(
  cart: NativeCheckoutCart,
  enabled: boolean,
  production: boolean,
  resolveDependencies: () => NativeCartLegalSellerDependencies,
): Promise<void> {
  if (!enabled) return
  if (production) throw new Error("Native legal seller gate not production-certified")
  let deps: NativeCartLegalSellerDependencies
  try {
    deps = resolveDependencies()
  } catch {
    throw new Error("Native legal seller denied: trusted dependency not registered")
  }
  await assertNativeCartLegalSeller(cart, deps)
}
