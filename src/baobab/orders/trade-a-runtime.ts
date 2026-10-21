/**
 * ADR-SHARED-039 Trade-A TA-06: the trusted runtime dependencies of the
 * order-authority PEP, built lazily and only when governOrderEntry needs
 * them (never in production or an uncertified protected runtime).
 *
 * Every input is server-side: Medusa's own sales-channel and region state,
 * Trade's append-only attestation, attribution and receipt tables, and CP
 * over an IAM workload credential. A missing setting throws, which the
 * gate maps to a 503 denial, never to a fallback.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { Pool } from "pg"
import { getBaobabTradeEnvironment } from "../config/environment"
import { HttpControlPlaneClient } from "../control-plane/client"
import { HttpTradeOrderAuthorityClient } from "../control-plane/trade-order-authority"
import { ClientCredentialsWorkloadTokenProvider } from "../control-plane/workload-token"
import { PostgresCommitmentAttributionStore } from "./commitment-attribution"
import { medusaNativeSellerFacts } from "./medusa-native-seller-facts"
import { PostgresAttestedNativeConfigurationReader } from "./native-configuration-resolver"
import {
  PostgresOrderAuthorityReceiptStore,
  type OrderAuthorityEnforcementDependencies,
} from "./order-authority-enforcement"
import { PostgresPersistencePostureReader } from "./persistence-posture"
import type { PgPool } from "./postgres-governed-binding-persistence"

const required = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Trade-A order authority requires ${name}`)
  return value
}

type Shared = Omit<OrderAuthorityEnforcementDependencies, "facts" | "environment">
let shared: Shared | undefined

function sharedDependencies(): Shared {
  if (shared) return shared
  const baseUrl = required("BAOBAB_CONTROL_PLANE_BASE_URL")
  const url = required("DATABASE_URL")
  if (!["postgres:", "postgresql:"].includes(new URL(url).protocol))
    throw new Error("Trade-A order authority requires the trusted runtime database")
  const pool = new Pool({
    connectionString: url,
    max: 4,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    application_name: "baobab-trade-order-authority",
  })
  // Never log the URL, credentials or the raw driver error.
  pool.on("error", () => console.error("Trade-A order-authority database connection unavailable"))
  const pg: PgPool = {
    connect: async () => {
      const client = await pool.connect()
      return {
        query: (sql, values) => client.query(sql, values ? [...values] : []),
        release: () => client.release(),
      }
    },
  }
  const environment = getBaobabTradeEnvironment()
  shared = {
    engineInstanceId: required("BAOBAB_TRADE_ENGINE_INSTANCE_ID"),
    attested: new PostgresAttestedNativeConfigurationReader(pg),
    tokens: new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: required("BAOBAB_IAM_WORKLOAD_TOKEN_URL"),
      clientId: required("BAOBAB_IAM_WORKLOAD_CLIENT_ID"),
      clientSecret: required("BAOBAB_IAM_WORKLOAD_CLIENT_SECRET"),
    }),
    controlPlane: new HttpControlPlaneClient({
      baseUrl,
      contextPath: environment.controlPlaneContextPath,
      productId: environment.controlPlaneProductId,
      marketPathTemplate: environment.controlPlaneMarketPathTemplate,
      mappingResolutionPath: environment.controlPlaneMappingResolutionPath,
      platformContextPath: environment.controlPlanePlatformContextPath,
    }),
    authority: new HttpTradeOrderAuthorityClient(baseUrl),
    store: new PostgresCommitmentAttributionStore(pg),
    receipts: new PostgresOrderAuthorityReceiptStore(pg),
    posture: new PostgresPersistencePostureReader(pg),
  }
  return shared
}

/**
 * Container key for explicitly synthetic dependencies (engine-local
 * regressions only). Registration never relaxes the gate: governOrderEntry
 * still applies the runtime profile, and production is denied before any
 * dependency is resolved.
 */
export const TRADE_A_DEPENDENCY_KEY = "baobab_trade_a_order_authority_dependencies"

/** The PEP's dependencies for one request's container. */
export function tradeOrderAuthorityDependencies(
  container: MedusaContainer,
): OrderAuthorityEnforcementDependencies {
  if (container.hasRegistration?.(TRADE_A_DEPENDENCY_KEY))
    return container.resolve<OrderAuthorityEnforcementDependencies>(TRADE_A_DEPENDENCY_KEY)
  return {
    ...sharedDependencies(),
    facts: medusaNativeSellerFacts(container),
    // governOrderEntry supplies the real runtime profile.
    environment: {},
  }
}
