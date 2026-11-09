/**
 * ADR-0008 §§8–11, 82–85: validate the runtime trust boundary before Medusa
 * loads its modules. This is deliberately independent of deployment provider,
 * Control Plane availability, and HTTP handlers; it never prints secret values.
 *
 * Validation is not Control Plane registration or capability authorisation.
 * Those require a separately evidenced CP handshake and must fail closed at
 * their own operation gates.
 */
export type TradeDeploymentEnvironment = "development" | "staging" | "production"

export type TradeStartupIdentity = Readonly<{
  engineId: string
  engineInstanceId?: string
  environment?: TradeDeploymentEnvironment
  region?: string
  revision?: string
}>

const ENGINE_INSTANCE_ID = /^ei_[a-z0-9]+$/
const REGION = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const REVISION = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/
const DEPLOYMENT_ENVIRONMENTS = new Set<string>(["development", "staging", "production"])

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim()
  if (!value) throw new Error(`${key} must be configured for this Trade runtime`)
  return value
}

/** Do not turn typoed security flags into silent feature disablement. */
export const readTradeFeatureFlag = (value: string | undefined, key: string): boolean => {
  if (value === undefined || value === "false") return false
  if (value === "true") return true
  throw new Error(`${key} must be exactly true or false`)
}

const validateServiceUrl = (
  env: NodeJS.ProcessEnv,
  key: string,
  productionRuntime: boolean,
): void => {
  const raw = env[key]
  if (raw === undefined) return
  let value: URL
  try {
    value = new URL(raw)
  } catch {
    throw new Error(`${key} must be a valid service URL`)
  }
  if (
    !["http:", "https:"].includes(value.protocol) ||
    Boolean(value.username || value.password || value.search || value.hash) ||
    (productionRuntime && value.protocol !== "https:")
  ) {
    throw new Error(`${key} must be a credential-free service URL with HTTPS in production`)
  }
}

const validateDatabaseUrl = (env: NodeJS.ProcessEnv): void => {
  const input = required(env, "DATABASE_URL")
  let protocol: string
  try {
    protocol = new URL(input).protocol
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL")
  }
  if (!["postgres:", "postgresql:"].includes(protocol)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL")
  }
}

/**
 * NODE_ENV selects the Node/Medusa production runtime; BAOBAB_ENVIRONMENT
 * identifies the actual deployment. A staging deployment normally runs with
 * NODE_ENV=production, so the two are intentionally not forced to match.
 */
export const validateTradeStartupConfiguration = (
  env: NodeJS.ProcessEnv,
): TradeStartupIdentity => {
  const productionRuntime = env.NODE_ENV === "production"
  const buyerEnabled = readTradeFeatureFlag(
    env.BAOBAB_BUYER_IDENTITY_ENABLED,
    "BAOBAB_BUYER_IDENTITY_ENABLED",
  )
  const resourceAssignmentEnabled = readTradeFeatureFlag(
    env.BAOBAB_RESOURCE_ASSIGNMENT_ENABLED,
    "BAOBAB_RESOURCE_ASSIGNMENT_ENABLED",
  )

  const engineId = env.BAOBAB_TRADE_ENGINE_ID?.trim() || "baobab-trade"
  if (!/^[a-z][a-z0-9.-]*$/.test(engineId)) {
    throw new Error("BAOBAB_TRADE_ENGINE_ID must be a registered engine identifier")
  }

  const engineInstanceId = env.BAOBAB_TRADE_ENGINE_INSTANCE_ID?.trim() || undefined
  if (engineInstanceId && !ENGINE_INSTANCE_ID.test(engineInstanceId)) {
    throw new Error("BAOBAB_TRADE_ENGINE_INSTANCE_ID must be a CP-minted engine instance ID")
  }

  const deploymentEnvironment = env.BAOBAB_ENVIRONMENT?.trim()
  if (deploymentEnvironment && !DEPLOYMENT_ENVIRONMENTS.has(deploymentEnvironment)) {
    throw new Error("BAOBAB_ENVIRONMENT must identify a supported deployment environment")
  }
  const environment = deploymentEnvironment as TradeDeploymentEnvironment | undefined
  if (environment === "production" && env.NODE_ENV !== "production") {
    throw new Error("NODE_ENV must be production for a production deployment")
  }
  const region = env.BAOBAB_REGION?.trim() || undefined
  if (region && !REGION.test(region)) {
    throw new Error("BAOBAB_REGION must be a stable deployment region identifier")
  }
  const revision = env.BAOBAB_DEPLOYMENT_REVISION?.trim() || undefined
  if (revision && (!REVISION.test(revision) || ["unknown", "latest"].includes(revision))) {
    throw new Error("BAOBAB_DEPLOYMENT_REVISION must identify an immutable deployment revision")
  }

  for (const key of [
    "BAOBAB_CONTROL_PLANE_BASE_URL",
    "BAOBAB_ERP_API_BASE_URL",
    "BAOBAB_PULSE_API_BASE_URL",
    "BAOBAB_IAM_WORKLOAD_TOKEN_URL",
    "BAOBAB_IAM_BUYER_ISSUER",
  ]) {
    validateServiceUrl(env, key, productionRuntime)
  }

  if (productionRuntime) {
    for (const key of [
      "JWT_SECRET",
      "COOKIE_SECRET",
      "BAOBAB_WEBHOOK_SIGNING_SECRET",
      "REDIS_URL",
      "BAOBAB_CONTROL_PLANE_BASE_URL",
      "BAOBAB_TRADE_ENGINE_ID",
      "BAOBAB_TRADE_ENGINE_INSTANCE_ID",
      "BAOBAB_ENVIRONMENT",
      "BAOBAB_REGION",
      "BAOBAB_DEPLOYMENT_REVISION",
    ]) {
      required(env, key)
    }
    validateDatabaseUrl(env)
    let redisProtocol: string
    try {
      redisProtocol = new URL(required(env, "REDIS_URL")).protocol
    } catch {
      throw new Error("REDIS_URL must be a Redis connection URL")
    }
    if (!["redis:", "rediss:"].includes(redisProtocol)) {
      throw new Error("REDIS_URL must be a Redis connection URL")
    }
    for (const key of ["JWT_SECRET", "COOKIE_SECRET", "BAOBAB_WEBHOOK_SIGNING_SECRET"]) {
      const value = required(env, key)
      if (value.length < 32 || /^(?:change-me|development-|example|test-)/i.test(value)) {
        throw new Error(`${key} must use a non-placeholder runtime secret of sufficient length`)
      }
    }
  }

  // An enabled buyer or resource-assignment path may not silently omit its
  // workload credentials or the deployment identity to which CP attests.
  if (buyerEnabled || resourceAssignmentEnabled) {
    for (const key of [
      "BAOBAB_CONTROL_PLANE_BASE_URL",
      "BAOBAB_IAM_WORKLOAD_TOKEN_URL",
      "BAOBAB_IAM_WORKLOAD_CLIENT_ID",
      "BAOBAB_IAM_WORKLOAD_CLIENT_SECRET",
      "BAOBAB_TRADE_ENGINE_INSTANCE_ID",
      "BAOBAB_ENVIRONMENT",
    ]) {
      required(env, key)
    }
  }
  if (buyerEnabled) {
    required(env, "BAOBAB_IAM_BUYER_ISSUER")
    const parties = required(env, "BAOBAB_IAM_BUYER_AUTHORISED_PARTIES")
    if (!parties.split(",").some((party) => party.trim().length > 0)) {
      throw new Error("BAOBAB_IAM_BUYER_AUTHORISED_PARTIES must include a client identifier")
    }
  }
  if (resourceAssignmentEnabled && environment === "production") {
    throw new Error("BAOBAB_RESOURCE_ASSIGNMENT_ENABLED is not approved for production")
  }

  return { engineId, engineInstanceId, environment, region, revision }
}
