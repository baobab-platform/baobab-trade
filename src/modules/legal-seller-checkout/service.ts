import {
  AuthenticatedBindingIntake,
  type NativeBindingCoordinates,
  type BindingActivation,
} from "../../baobab/orders/authenticated-binding-intake"
import {
  HttpBindingAuthorityClient,
  type BindingOperation,
} from "../../baobab/orders/binding-authority-client"
import {
  bindingAuthorizationResponseSchema,
  legalActorResponseSchema,
} from "../../baobab/contracts/authority-validation"
import { Pool } from "pg"
import { resolveNativeCheckoutEnvironment } from "../../baobab/orders/native-cart-legal-seller"
import { PostgresGovernedBindingPersistence } from "../../baobab/orders/postgres-governed-binding-persistence"
import { MedusaService } from "@medusajs/framework/utils"
import { getBaobabTradeEnvironment } from "../../baobab/config/environment"
import { HttpControlPlaneClient, type ControlPlaneClient } from "../../baobab/control-plane/client"
import { HttpLegalActorAssessmentClient } from "../../baobab/control-plane/legal-actor-assessment"
import { HttpDocumentaryRestrictionClient } from "../../baobab/control-plane/documentary-restriction"
import { ClientCredentialsWorkloadTokenProvider } from "../../baobab/control-plane/workload-token"
import type {
  NativeCartIdentity,
  NativeCartLegalSellerDependencies,
  TrustedNativeSellerBinding,
} from "../../baobab/orders/native-cart-legal-seller"
import { HttpPaymentsMerchantReadinessAdapter } from "../../baobab/orders/payments-seller-readiness"
import { assertIndependentlyApprovedBinding } from "../../baobab/orders/cart-binding-approval"
import { assertCurrentSellerMarketContext } from "../../baobab/orders/seller-market-context"
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
 * the storefront. The module always installs storage; external checkout ports remain guarded.
 */
class NativeSellerCheckoutModuleService
  extends MedusaService({ NativeSellerCartBinding })
  implements NativeCartLegalSellerDependencies
{
  private readonly environment = getBaobabTradeEnvironment()

  private checkoutRuntime?: {
    tokens: ClientCredentialsWorkloadTokenProvider
    controlPlane: ControlPlaneClient
    cp: HttpLegalActorAssessmentClient
    documentary: HttpDocumentaryRestrictionClient
    readiness: HttpPaymentsMerchantReadinessAdapter
  }
  private governancePool?: Pool
  private governancePersistence?: PostgresGovernedBindingPersistence

  /** Schema/storage is always installed; credentials are built only for the
   * protected gate. An empty module is never a merchant/checkout activation. */
  private runtime() {
    const profile = resolveNativeCheckoutEnvironment({
      node: process.env.NODE_ENV,
      baobab: process.env.BAOBAB_ENVIRONMENT,
      deployment: process.env.BAOBAB_DEPLOYMENT_ENV,
    })
    if (process.env.BAOBAB_LA05_NATIVE_CHECKOUT_GUARD !== "true" || profile.production) {
      throw new Error("Native legal seller denied: guarded non-production runtime required")
    }
    if (!this.checkoutRuntime)
      this.checkoutRuntime = {
        tokens: new ClientCredentialsWorkloadTokenProvider({
          tokenUrl: requireEnv("BAOBAB_IAM_WORKLOAD_TOKEN_URL"),
          clientId: requireEnv("BAOBAB_IAM_WORKLOAD_CLIENT_ID"),
          clientSecret: requireEnv("BAOBAB_IAM_WORKLOAD_CLIENT_SECRET"),
        }),

        controlPlane: new HttpControlPlaneClient({
          baseUrl: requireEnv("BAOBAB_CONTROL_PLANE_BASE_URL"),
          contextPath: this.environment.controlPlaneContextPath,
          productId: this.environment.controlPlaneProductId,
          marketPathTemplate: this.environment.controlPlaneMarketPathTemplate,
          mappingResolutionPath: this.environment.controlPlaneMappingResolutionPath,
          platformContextPath: this.environment.controlPlanePlatformContextPath,
        }),

        cp: new HttpLegalActorAssessmentClient(requireEnv("BAOBAB_CONTROL_PLANE_BASE_URL")),

        // Fail closed if the independent, client-scoped documentary veto is not configured.
        documentary: new HttpDocumentaryRestrictionClient(
          requireEnv("BAOBAB_CONTROL_PLANE_BASE_URL"),
        ),

        readiness: new HttpPaymentsMerchantReadinessAdapter({
          url: requireEnv("BAOBAB_PAYMENTS_SELLER_READINESS_URL"),
          tokens: new ClientCredentialsWorkloadTokenProvider({
            tokenUrl: requireEnv("BAOBAB_PAYMENTS_WORKLOAD_TOKEN_URL"),
            clientId: requireEnv("BAOBAB_PAYMENTS_WORKLOAD_CLIENT_ID"),
            clientSecret: requireEnv("BAOBAB_PAYMENTS_WORKLOAD_CLIENT_SECRET"),
          }),
        }),
      }
    return this.checkoutRuntime
  }
  get tokens() {
    return this.runtime().tokens
  }
  get cp() {
    return this.runtime().cp
  }
  get documentary() {
    return this.runtime().documentary
  }
  get readiness() {
    return this.runtime().readiness
  }
  private get controlPlane() {
    return this.runtime().controlPlane
  }

  /** Internal persistence port: HTTP intake composes current CP authority.
   * The caller must compose actual CP admission/context/legal authorities through the
   * governed command service; the database independently fences receipts. */
  get bindingPersistence(): PostgresGovernedBindingPersistence {
    if (!this.governancePersistence) {
      const url = process.env.DATABASE_URL
      if (!url || !["postgres:", "postgresql:"].includes(new URL(url).protocol)) {
        throw new Error("Governed binding persistence requires the trusted runtime database")
      }
      this.governancePool = new Pool({
        connectionString: url,
        max: 4,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 30000,
        application_name: "baobab-trade-binding-lifecycle",
      })
      // pg emits idle connection failures on the pool. Retain a listener so
      // an idle socket failure cannot become an unhandled process exception;
      // never log the database URL, credentials or raw driver error.
      this.governancePool.on("error", () =>
        console.error("Governed binding database connection unavailable"),
      )
      const pool = this.governancePool
      this.governancePersistence = new PostgresGovernedBindingPersistence({
        connect: async () => {
          const client = await pool.connect()
          return {
            query: (sql, values) => client.query(sql, values ? [...values] : []),
            release: () => client.release(),
          }
        },
      })
    }
    return this.governancePersistence
  }
  /** The actual CP human token is sent only to the trusted CP origin. No
   * Medusa administrator identity is promoted into platform authority. */
  async executeBindingCommand(
    operation: BindingOperation,
    cartId: string,
    input: unknown,
    token: string,
    native: (id: string) => Promise<NativeBindingCoordinates>,
  ): Promise<void> {
    const profile = resolveNativeCheckoutEnvironment({
      node: process.env.NODE_ENV,
      baobab: process.env.BAOBAB_ENVIRONMENT,
      deployment: process.env.BAOBAB_DEPLOYMENT_ENV,
    })
    if (process.env.BAOBAB_BINDING_INTAKE_ENABLED !== "true" || profile.production)
      throw new Error("Binding intake requires explicit non-production enablement")
    // Withdrawing a binding must not require the old workload credential to
    // remain configured/admitted. Only non-withdrawal legal checks request it.
    let tokens: ClientCredentialsWorkloadTokenProvider | undefined
    const workloadToken = () => {
      tokens ??= new ClientCredentialsWorkloadTokenProvider({
        tokenUrl: requireEnv("BAOBAB_IAM_WORKLOAD_TOKEN_URL"),
        clientId: requireEnv("BAOBAB_IAM_WORKLOAD_CLIENT_ID"),
        clientSecret: requireEnv("BAOBAB_IAM_WORKLOAD_CLIENT_SECRET"),
      })
      return tokens.getAccessToken()
    }
    const intake = new AuthenticatedBindingIntake(
      new HttpBindingAuthorityClient(requireEnv("BAOBAB_CONTROL_PLANE_BASE_URL")),
      this.bindingPersistence,
      native,
      workloadToken,
    )
    await intake.execute(operation, cartId, input, token)
  }
  __hooks = {
    onApplicationShutdown: async () => {
      const pool = this.governancePool
      this.governancePool = undefined
      this.governancePersistence = undefined
      await pool?.end()
    },
  }

  /** P0-04B-03: database-only store; the cart trigger is the commit fence. */
  get authorizations(): PostgresGovernedBindingPersistence {
    return this.bindingPersistence
  }

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
    const activation = row.activation_snapshot as BindingActivation | null
    if (
      !activation ||
      !bindingAuthorizationResponseSchema(activation.admission) ||
      !legalActorResponseSchema(activation.legalDecision) ||
      activation.context.context_id !== row.context_id ||
      activation.context.tenant_id !== row.tenant_id ||
      activation.context.organisation_id !== row.organisation_id ||
      activation.context.country_code !== row.market_code ||
      activation.context.currency_code !== row.currency_code ||
      !activation.context.expires_at ||
      Date.parse(activation.context.expires_at) <= now ||
      [row.proposed_by, row.approved_by].includes(activation.actor.subject)
    )
      throw new Error("Native seller binding requires current recorded CP activation")
    assertIndependentlyApprovedBinding(
      {
        cartId: row.cart_id,
        proposedBy: row.proposed_by,
        proposedAt: String(row.proposed_at),
        approvedBy: row.approved_by ?? "",
        approvedAt: String(row.approved_at),
        approvalReference: row.approval_reference ?? "",
        approvalScope: row.approval_scope,
        expiresAt: String(row.expires_at),
      },
      now,
    )
    // The record is local evidence, not an independently verifiable
    // platform administrative grant; CP reattestation and CP-owned
    // legal-actor assessment remain required on EVERY operation.
    // Fresh, workload-scoped CP corroboration: a Trade-local DB row MUST NOT
    // be treated as canonical tenant/Organisation authority.
    const canonical = await this.controlPlane.resolvePlatformContext(
      row.tenant_id,
      row.organisation_id,
      await this.tokens.getAccessToken(),
      row.correlation_id,
      "ORGANISATION",
      row.market_code,
    )
    assertCurrentSellerMarketContext(
      canonical,
      {
        tenantId: row.tenant_id,
        organisationId: row.organisation_id,
        marketCode: row.market_code,
        currencyCode: row.currency_code,
      },
      Date.now(),
    )
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
