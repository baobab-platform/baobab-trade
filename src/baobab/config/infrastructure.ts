export type MedusaModuleConfig = {
  resolve: string
  options?: Record<string, unknown>
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]
  if (!value) throw new Error(`${name} must be configured in production`)
  return value
}

const optionalBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined
  if (value === "true") return true
  if (value === "false") return false
  throw new Error("S3_FORCE_PATH_STYLE must be either true or false")
}

export const buildProductionInfrastructureModules = (
  env: NodeJS.ProcessEnv,
): MedusaModuleConfig[] => {
  const redisUrl = required(env, "REDIS_URL")
  const redisPrefix = env.REDIS_KEY_PREFIX || "baobab-trade:production"
  const forcePathStyle = optionalBoolean(env.S3_FORCE_PATH_STYLE)

  return [
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl,
        queueName: env.REDIS_EVENT_QUEUE || "baobab-trade-events",
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: {
        redis: {
          redisUrl,
          queueName: env.REDIS_WORKFLOW_QUEUE || "baobab-trade-workflows",
        },
      },
    },
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/locking-redis",
            id: "locking-redis",
            is_default: true,
            options: { redisUrl, namespace: `${redisPrefix}:lock:` },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/caching",
      options: {
        providers: [
          {
            resolve: "@medusajs/caching-redis",
            id: "caching-redis",
            is_default: true,
            options: { redisUrl, prefix: `${redisPrefix}:cache:`, ttl: 3600 },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-s3",
            id: "s3",
            options: {
              file_url: required(env, "S3_FILE_URL"),
              access_key_id: required(env, "S3_ACCESS_KEY_ID"),
              secret_access_key: required(env, "S3_SECRET_ACCESS_KEY"),
              region: required(env, "S3_REGION"),
              bucket: required(env, "S3_BUCKET"),
              endpoint: env.S3_ENDPOINT,
              prefix: env.S3_OBJECT_PREFIX || "commerce/",
              additional_client_config:
                forcePathStyle === undefined ? undefined : { forcePathStyle },
            },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/notification-sendgrid",
            id: "sendgrid",
            options: {
              channels: ["email"],
              api_key: required(env, "SENDGRID_API_KEY"),
              from: required(env, "SENDGRID_FROM"),
            },
          },
        ],
      },
    },
  ]
}

export const getInfrastructureModules = (
  environment = process.env.NODE_ENV,
  env = process.env,
): MedusaModuleConfig[] =>
  environment === "production" ? buildProductionInfrastructureModules(env) : []
