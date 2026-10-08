export type BaobabTradeEnvironment = {
  engineId: string
  controlPlaneBaseUrl?: string
  controlPlaneContextPath: string
  controlPlaneMarketPathTemplate: string
  controlPlaneMappingResolutionPath: string
  controlPlanePlatformContextPath: string
  controlPlaneProductId: string
  erpApiBaseUrl?: string
  pulseApiBaseUrl?: string
  webhookSigningSecret?: string
  // Workload (client-credentials) identity for server-to-server calls into
  // baobab-cp, e.g. the ZB-03.6 tenant/organisation attestation check.
  // Deliberately opt-in (unset -> feature disabled) rather than
  // requiredInProduction: the `baobab-trade-workload` Keycloak client
  // exists in baobab-iam config, but this is the first code in this repo
  // to consume it, so it stays off until a live deployment configures it.
  iamWorkloadTokenUrl?: string
  iamWorkloadClientId: string
  iamWorkloadClientSecret?: string
  logLevel: string
}

const requiredInProduction = (name: string, value: string | undefined): string | undefined => {
  if (process.env.NODE_ENV === "production" && !value) {
    throw new Error(`${name} must be configured in production`)
  }
  return value
}

export const getBaobabTradeEnvironment = (): BaobabTradeEnvironment => ({
  engineId: process.env.BAOBAB_TRADE_ENGINE_ID || "baobab-trade",
  controlPlaneBaseUrl: requiredInProduction(
    "BAOBAB_CONTROL_PLANE_BASE_URL",
    process.env.BAOBAB_CONTROL_PLANE_BASE_URL,
  ),
  controlPlaneContextPath: process.env.BAOBAB_CONTROL_PLANE_CONTEXT_PATH || "/v1/context/resolve",
  controlPlaneMarketPathTemplate:
    process.env.BAOBAB_CONTROL_PLANE_MARKET_PATH_TEMPLATE || "/v1/markets/{market_id}",
  controlPlaneMappingResolutionPath:
    process.env.BAOBAB_CONTROL_PLANE_MAPPING_RESOLUTION_PATH || "/v1/resolution/mappings",
  controlPlanePlatformContextPath:
    process.env.BAOBAB_CONTROL_PLANE_PLATFORM_CONTEXT_PATH || "/v1/platform-context/resolve",
  controlPlaneProductId: process.env.BAOBAB_CONTROL_PLANE_PRODUCT_ID || "baobab-trade",
  erpApiBaseUrl: process.env.BAOBAB_ERP_API_BASE_URL,
  pulseApiBaseUrl: process.env.BAOBAB_PULSE_API_BASE_URL,
  webhookSigningSecret: requiredInProduction(
    "BAOBAB_WEBHOOK_SIGNING_SECRET",
    process.env.BAOBAB_WEBHOOK_SIGNING_SECRET,
  ),
  iamWorkloadTokenUrl: process.env.BAOBAB_IAM_WORKLOAD_TOKEN_URL,
  iamWorkloadClientId: process.env.BAOBAB_IAM_WORKLOAD_CLIENT_ID || "baobab-trade-workload",
  iamWorkloadClientSecret: process.env.BAOBAB_IAM_WORKLOAD_CLIENT_SECRET,
  logLevel: process.env.LOG_LEVEL || "info",
})
