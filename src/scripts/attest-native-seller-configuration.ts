/**
 * ADR-SHARED-039 Trade-0 operator command: attest this Trade instance's
 * native seller configuration to the CP Seller Operating Binding registry.
 *
 *   BAOBAB_SELLER_ATTESTATION_ENABLED=true npm run attest:native-seller-configuration
 *
 * The declared scope names WHICH native channels and regions form the
 * seller's operating context; their live attributes are read from Medusa and
 * digested here. The result is an attestation id a human maker cites when
 * proposing a binding in CP. It authorises nothing, and production is refused.
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { Pool } from "pg"
import { getBaobabTradeEnvironment } from "../baobab/config/environment"
import { HttpControlPlaneClient } from "../baobab/control-plane/client"
import { HttpSellerBindingAttestationClient } from "../baobab/control-plane/seller-binding-attestation"
import { ClientCredentialsWorkloadTokenProvider } from "../baobab/control-plane/workload-token"
import {
  attestNativeSellerConfiguration,
  PostgresNativeConfigurationAttestationStore,
} from "../baobab/orders/native-configuration-attestation"
import { medusaNativeSellerFacts } from "../baobab/orders/medusa-native-seller-facts"
import type { NativeSellerConfigurationScope } from "../baobab/orders/native-seller-configuration"

const required = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Native-configuration attestation requires ${name}`)
  return value
}
const list = (name: string): string[] =>
  required(name)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)

// Re-exported for the regression; the runtime PEP uses the same reader.
export { medusaNativeSellerFacts }

export default async function attestNativeSellerConfigurationCommand({
  container,
}: ExecArgs): Promise<void> {
  const scope: NativeSellerConfigurationScope = {
    reference: required("BAOBAB_SELLER_NATIVE_CONFIGURATION_REFERENCE"),
    tenantId: required("BAOBAB_SELLER_TENANT_ID"),
    organisationId: required("BAOBAB_SELLER_ORGANISATION_ID"),
    market: required("BAOBAB_SELLER_MARKET"),
    engineInstanceId: required("BAOBAB_TRADE_ENGINE_INSTANCE_ID"),
    currencyScope: list("BAOBAB_SELLER_CURRENCY_SCOPE"),
    salesChannelIds: list("BAOBAB_SELLER_SALES_CHANNEL_IDS"),
    regionIds: list("BAOBAB_SELLER_REGION_IDS"),
  }
  const baseUrl = required("BAOBAB_CONTROL_PLANE_BASE_URL")
  const environment = getBaobabTradeEnvironment()
  const pool = new Pool({
    connectionString: required("DATABASE_URL"),
    max: 1,
    application_name: "baobab-trade-native-configuration-attestation",
  })
  try {
    const recorded = await attestNativeSellerConfiguration(scope, {
      facts: medusaNativeSellerFacts(container),
      controlPlane: new HttpControlPlaneClient({
        baseUrl,
        contextPath: environment.controlPlaneContextPath,
        productId: environment.controlPlaneProductId,
        marketPathTemplate: environment.controlPlaneMarketPathTemplate,
        mappingResolutionPath: environment.controlPlaneMappingResolutionPath,
        platformContextPath: environment.controlPlanePlatformContextPath,
      }),
      attestations: new HttpSellerBindingAttestationClient(baseUrl),
      tokens: new ClientCredentialsWorkloadTokenProvider({
        tokenUrl: required("BAOBAB_IAM_WORKLOAD_TOKEN_URL"),
        clientId: required("BAOBAB_IAM_WORKLOAD_CLIENT_ID"),
        clientSecret: required("BAOBAB_IAM_WORKLOAD_CLIENT_SECRET"),
      }),
      store: new PostgresNativeConfigurationAttestationStore({
        connect: async () => {
          const client = await pool.connect()
          return {
            query: (sql, values) => client.query(sql, values ? [...values] : []),
            release: () => client.release(),
          }
        },
      }),
      environment: {
        node: process.env.NODE_ENV,
        baobab: process.env.BAOBAB_ENVIRONMENT,
        deployment: process.env.BAOBAB_DEPLOYMENT_ENV,
        enabled: process.env.BAOBAB_SELLER_ATTESTATION_ENABLED,
      },
    })
    // Identifiers and the digest only: never the canonical document or tokens.
    console.info(
      JSON.stringify({
        attestation_id: recorded.attestation_id,
        native_configuration_reference: recorded.native_configuration_reference,
        native_configuration_digest: recorded.native_configuration_digest,
        currency_scope: recorded.currency_scope,
        recorded_at: recorded.recorded_at,
      }),
    )
  } finally {
    await pool.end()
  }
}
