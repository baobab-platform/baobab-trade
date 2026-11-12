import { createHash, createPublicKey } from "node:crypto"
import { Pool } from "pg"
import type { PgPool } from "../orders/postgres-governed-binding-persistence"
import { getBaobabTradeEnvironment } from "../config/environment"
import { HttpControlPlaneClient } from "../control-plane/client"
import { ClientCredentialsWorkloadTokenProvider } from "../control-plane/workload-token"
import { HttpTradePriceIssuerAuthority } from "../control-plane/trade-price-issuer"
import { canonicalEventFingerprint } from "../events/outbox"
import { isValidCloudEvent } from "../events/event-contracts"
import type { BaobabTenantContext } from "../contracts/tenant-context"
import type { BuyerIdentitySnapshot } from "./buyer-authority"
import { PostgresSpendReservationCommands } from "./spend-reservation-commands"
import { HttpGovernedCartChargeSource } from "./http-governed-cart-charge-source"

export const NATIVE_BUYER_COMMIT_RUNTIME = "baobab_native_buyer_commit_runtime"
const unavailable = (): never => {
  throw new Error("NATIVE_BUYER_COMMIT_RUNTIME_UNAVAILABLE")
}
let shared: ReturnType<typeof buildRuntime> | undefined

function endpoint(value: string, allowHttp: boolean): URL {
  const url = new URL(value)
  if (
    !(url.protocol === "https:" || (allowHttp && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    return unavailable()
  return url
}

function buildRuntime(env: NodeJS.ProcessEnv) {
  const required = (key: string) => env[key]?.trim() || unavailable()
  const allowHttp = env.BAOBAB_NATIVE_BUYER_ALLOW_DEV_HTTP === "true"
  const cp = endpoint(required("BAOBAB_CONTROL_PLANE_BASE_URL"), allowHttp)
  if (cp.pathname !== "/") return unavailable()
  const tokenUrl = endpoint(required("BAOBAB_IAM_WORKLOAD_TOKEN_URL"), allowHttp)
  const workload = (prefix: string, scope: string, audience: string) =>
    new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: tokenUrl.href,
      clientId: required(prefix + "_CLIENT_ID"),
      clientSecret: required(prefix + "_CLIENT_SECRET"),
      scope,
      audience,
    })
  const issuerToken = workload(
    "BAOBAB_IAM_WORKLOAD",
    "context:resolve trade-order-authority:resolve",
    "baobab-control-plane",
  )
  const marketToken = workload("BAOBAB_NATIVE_BUYER_MARKET", "market:read", "baobab-control-plane")
  const contextToken = workload(
    "BAOBAB_NATIVE_BUYER_TENANT",
    "context:resolve",
    "baobab-control-plane",
  )
  const keyPem = required("BAOBAB_NATIVE_PRICE_ISSUER_PUBLIC_KEY_PEM")
  const key = createPublicKey(keyPem)
  if (key.asymmetricKeyType !== "ed25519") return unavailable()
  const signer = createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex")
  const authority = new HttpTradePriceIssuerAuthority(cp, issuerToken, signer)
  const database = required("DATABASE_URL")
  if (!["postgres:", "postgresql:"].includes(new URL(database).protocol)) return unavailable()
  const config = getBaobabTradeEnvironment()
  const cpClient = () =>
    new HttpControlPlaneClient({
      baseUrl: cp.origin,
      productId: config.controlPlaneProductId,
      contextPath: config.controlPlaneContextPath,
      marketPathTemplate: config.controlPlaneMarketPathTemplate,
    })
  const pool = new Pool({
    connectionString: database,
    max: 4,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
    application_name: "baobab-trade-native-buyer",
  })
  pool.on("error", () => console.error("Native buyer database connection unavailable"))
  const pg: PgPool = {
    async connect() {
      const client = await pool.connect()
      return {
        query: (sql, params) => client.query(sql, params ? [...params] : []),
        release: () => client.release(),
      }
    },
  }
  return {
    markets: cpClient(),
    tokens: marketToken,
    spend: new PostgresSpendReservationCommands(pg),
    verifyCurrentIssuer: (
      check: Parameters<typeof authority.verifyCurrent>[0],
      correlation: string,
    ) => authority.verifyCurrent(check, correlation),
    chargeSource(correlation: string) {
      const url = endpoint(required("BAOBAB_NATIVE_PRICE_ISSUER_ENDPOINT"), false)
      return new HttpGovernedCartChargeSource({
        endpoint: url.href,
        publicKeyPem: keyPem,
        db: pg,
        workload: workload(
          "BAOBAB_NATIVE_PRICE_PROVIDER",
          "trade:cart-final-charges",
          required("BAOBAB_NATIVE_PRICE_PROVIDER_AUDIENCE"),
        ),
        cpVerifier: (evidence) => authority.verifyPackage(evidence, correlation),
      })
    },
    async resolveTenant(request: {
      cartId: string
      countryCode: string
      correlationId: string
    }): Promise<BaobabTenantContext> {
      const result = await pool.query(
        `SELECT b.tenant_id,b.responsible_legal_entity_id
        FROM native_seller_cart_binding b JOIN cart c ON c.id=b.cart_id AND c.deleted_at IS NULL
        WHERE b.cart_id=$1 AND b.market_code=$2 AND b.status='ACTIVE' AND b.deleted_at IS NULL
          AND b.expires_at>clock_timestamp()`,
        [request.cartId, request.countryCode],
      )
      if (result.rows.length !== 1) return unavailable()
      const binding = result.rows[0]
      // A fresh CP entitlement each time, for the native binding tenant.
      // The native binding cannot grant tenancy by itself.
      const context = await cpClient().resolveContext(
        await contextToken.getAccessToken(),
        request.correlationId,
        typeof binding.tenant_id === "string" ? binding.tenant_id : unavailable(),
      )
      if (
        context.tenantId !== binding.tenant_id ||
        context.entityId !== binding.responsible_legal_entity_id ||
        context.correlationId !== request.correlationId
      )
        return unavailable()
      return context
    },
    async verifyReplay(
      tenant: BaobabTenantContext,
      orderId: string,
      cartId: string,
      key: string,
      buyer: BuyerIdentitySnapshot,
    ) {
      const result = await pool.query(
        `SELECT e.envelope,e.envelope_digest,e.event_id
        FROM trade_buyer_authority_consumption u
        JOIN trade_buyer_authority_receipt a ON a.receipt_id=u.receipt_id
        JOIN trade_order_commitment s ON s.order_id=u.order_id AND s.receipt_id=u.seller_receipt_id AND s.subject_id=$4
        JOIN b2b_spend_reservation r ON r.id=u.spend_reservation_id AND r.status='COMMITTED'
          AND r.tenant_id=$2 AND r.purchase_reference=$4 AND r.organisation_id=$7 AND r.membership_id=$8
        JOIN "order" o ON o.id=u.order_id AND o.is_draft_order=false AND o.deleted_at IS NULL
        JOIN event_outbox e ON e.event_id=u.event_id AND e.tenant_id=$2 AND e.owner_legal_entity_id=$3
          AND e.idempotency_key=$5 AND e.deleted_at IS NULL AND e.event_type='com.baobab-platform.trade.order.placed.v1'
        WHERE u.order_id=$1 AND a.payload->>'tenant_id'=$2 AND a.payload->>'seller_legal_entity_id'=$3
          AND a.payload->>'resource_id'=$4 AND a.payload->>'actor_principal_id'=$6
          AND a.payload->>'buyer_organisation_id'=$7 AND a.payload->>'buyer_membership_id'=$8
          AND a.payload->>'membership_revision'=$9 AND a.payload->>'market_id'=$10`,
        [
          orderId,
          tenant.tenantId,
          tenant.entityId,
          cartId,
          key,
          buyer.actor_principal_id,
          buyer.buyer_organisation_id,
          buyer.buyer_membership_id,
          String(buyer.membership_revision),
          buyer.market_id,
        ],
      )
      const row = result.rows[0]
      return (
        result.rows.length === 1 &&
        isValidCloudEvent(row.envelope) &&
        row.envelope.id === row.event_id &&
        row.envelope.tenantid === tenant.tenantId &&
        row.envelope.data?.commerce_order_id === orderId &&
        canonicalEventFingerprint(row.envelope) === row.envelope_digest
      )
    },
  }
}

export function nativeBuyerCommitRuntime(env: NodeJS.ProcessEnv = process.env) {
  const environment = env.BAOBAB_ENVIRONMENT
  if (
    env.BAOBAB_NATIVE_BUYER_COMMIT_ENABLED !== "true" ||
    !["development", "integration"].includes(environment ?? "") ||
    [env.BAOBAB_DEPLOYMENT_ENV, env.NODE_ENV].some(
      (value) => value !== undefined && !["development", "integration", "test"].includes(value),
    ) ||
    env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  )
    return unavailable()
  return (shared ??= buildRuntime(env))
}
