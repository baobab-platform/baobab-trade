import { MedusaService } from "@medusajs/framework/utils"
import { getBaobabTradeEnvironment } from "../../baobab/config/environment"
import {
  HttpControlPlaneClient,
  type ControlPlaneClient,
} from "../../baobab/control-plane/client"
import { HttpLegalActorAssessmentClient } from "../../baobab/control-plane/legal-actor-assessment"
import { ClientCredentialsWorkloadTokenProvider } from "../../baobab/control-plane/workload-token"
import type {
  NativeCartIdentity,
  NativeCartLegalSellerDependencies,
  TrustedNativeSellerBinding,
} from "../../baobab/orders/native-cart-legal-seller"
import { HttpPaymentsMerchantReadinessAdapter } from "../../baobab/orders/payments-seller-readiness"
import NativeSellerCartBinding from "./models/native-seller-cart-binding"

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`LA-05C3 staging requires ${name}`)
  if (
    (name.endsWith("_URL") || name === "BAOBAB_CONTROL_PLANE_BASE_URL") &&
    !/^https:\/\//.test(value) &&
    !/^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(value)
  ) {
    throw new Error(`LA-05C3 requires a trusted HTTPS endpoint for ${name}`)
  }
  return value
}
const seconds = (v: unknown): number => new Date(String(v)).getTime()

/**
 * Real Medusa module backed by a governed PostgreSQL cart-binding table.
 * An empty table is DENY, not an invitation to derive seller identity from
 * the storefront. This module is registered only for guarded staging.
 */
class NativeSellerCheckoutModuleService
  extends MedusaService({ NativeSellerCartBinding })
  implements NativeCartLegalSellerDependencies
{
  private readonly environment = getBaobabTradeEnvironment()

  readonly tokens = new ClientCredentialsWorkloadTokenProvider({
    tokenUrl: requireEnv("BAOBAB_IAM_WORKLOAD_TOKEN_URL"),
    clientId: requireEnv("BAOBAB_IAM_WORKLOAD_CLIENT_ID"),
    clientSecret: requireEnv("BAOBAB_IAM_WORKLOAD_CLIENT_SECRET"),
  })

  private readonly controlPlane: ControlPlaneClient = new HttpControlPlaneClient({
    baseUrl: requireEnv("BAOBAB_CONTROL_PLANE_BASE_URL"),
    contextPath: this.environment.controlPlaneContextPath,
    productId: this.environment.controlPlaneProductId,
    marketPathTemplate: this.environment.controlPlaneMarketPathTemplate,
    mappingResolutionPath: this.environment.controlPlaneMappingResolutionPath,
    platformContextPath: this.environment.controlPlanePlatformContextPath,
  })

  readonly cp = new HttpLegalActorAssessmentClient(requireEnv("BAOBAB_CONTROL_PLANE_BASE_URL"))

  readonly readiness = new HttpPaymentsMerchantReadinessAdapter({
    url: requireEnv("BAOBAB_PAYMENTS_SELLER_READINESS_URL"),
    tokens: new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: requireEnv("BAOBAB_PAYMENTS_WORKLOAD_TOKEN_URL"),
      clientId: requireEnv("BAOBAB_PAYMENTS_WORKLOAD_CLIENT_ID"),
      clientSecret: requireEnv("BAOBAB_PAYMENTS_WORKLOAD_CLIENT_SECRET"),
    }),
  })

  readonly bindings = {
    resolveForCart: (cart: NativeCartIdentity): Promise<TrustedNativeSellerBinding> =>
      this.resolveTrustedCart(cart),
  }

  private async resolveTrustedCart(cart: NativeCartIdentity): Promise<TrustedNativeSellerBinding> {
    if (!cart.cartId || !cart.salesChannelId || !cart.regionId) {
      throw new Error("LA-05C3 denied: native cart identity incomplete")
    }
    const rows = await this.listNativeSellerCartBindings({
      cart_id: cart.cartId,
      status: "ACTIVE",
    })
    if (rows.length !== 1) {
      throw new Error("LA-05C3 denied: no uniquely governed cart binding")
    }
    const row = rows[0]
    const now = Date.now()
    if (
      row.sales_channel_id !== cart.salesChannelId ||
      row.region_id !== cart.regionId ||
      !row.tenant_id ||
      !row.organisation_id ||
      !row.context_id ||
      !row.responsible_legal_entity_id ||
      !row.approval_reference ||
      !row.approved_by ||
      !row.correlation_id ||
      !/^[A-Z]{2}$/.test(row.market_code) ||
      !/^[A-Z]{3}$/.test(row.currency_code) ||
      !Number.isFinite(seconds(row.approved_at)) ||
      seconds(row.approved_at) > now ||
      !Number.isFinite(seconds(row.expires_at)) ||
      seconds(row.expires_at) <= now
    ) {
      throw new Error("LA-05C3 denied: invalid or expired governed cart binding")
    }
    // Fresh, workload-scoped CP corroboration: a Trade-local DB row MUST NOT
    // be treated as canonical tenant/Organisation authority.
    const canonical = await this.controlPlane.resolvePlatformContext(
      row.tenant_id,
      row.organisation_id,
      await this.tokens.getAccessToken(),
      row.correlation_id,
    )
    if (
      canonical.tenant_id !== row.tenant_id ||
      canonical.organisation_id !== row.organisation_id ||
      (canonical.country_code && canonical.country_code !== row.market_code) ||
      (canonical.expires_at && seconds(canonical.expires_at) <= Date.now())
    ) {
      throw new Error("LA-05C3 denied: Control Plane tenant or Organisation disagrees")
    }
    // CP's legal-actor assessment independently checks that context_id is a
    // current RUNTIME handle owned by this SAME Trade workload principal.
    return {
      cartId: cart.cartId,
      salesChannelId: cart.salesChannelId,
      regionId: cart.regionId,
      tenantId: row.tenant_id,
      organisationId: row.organisation_id,
      legalContextId: row.context_id,
      legalSellerKey: row.responsible_legal_entity_id,
      marketCode: row.market_code,
      marketKey: row.market_key,
      legalActivity: row.legal_activity,
      legalCapability: row.legal_capability,
      currencyCode: row.currency_code,
      correlationId: row.correlation_id,
      orderReference: `cart/${cart.cartId}/complete`,
      idempotencyKey: `native-checkout/${cart.cartId}`,
      totalMinor: 0, // Not an order amount; native Medusa owns calculation.
    }
  }
}

export default NativeSellerCheckoutModuleService
