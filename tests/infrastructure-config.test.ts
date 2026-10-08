import { describe, expect, it } from "vitest"
import {
  buildProductionInfrastructureModules,
  getInfrastructureModules,
} from "../src/baobab/config/infrastructure"

const productionEnv = {
  REDIS_URL: "redis://redis:6379",
  S3_FILE_URL: "https://assets.example.com/trade",
  S3_ACCESS_KEY_ID: "access-key",
  S3_SECRET_ACCESS_KEY: "secret-key",
  S3_REGION: "auto",
  S3_BUCKET: "trade",
  SENDGRID_API_KEY: "sendgrid-key",
  SENDGRID_FROM: "trade@example.com",
} as NodeJS.ProcessEnv

describe("production infrastructure configuration", () => {
  it("retains Medusa defaults outside production", () => {
    expect(getInfrastructureModules("development", {})).toEqual([])
    expect(getInfrastructureModules("test", {})).toEqual([])
  })

  it("registers all required production infrastructure modules", () => {
    expect(
      buildProductionInfrastructureModules(productionEnv).map(({ resolve }) => resolve),
    ).toEqual([
      "@medusajs/medusa/event-bus-redis",
      "@medusajs/medusa/workflow-engine-redis",
      "@medusajs/medusa/locking",
      "@medusajs/medusa/caching",
      "@medusajs/medusa/file",
      "@medusajs/medusa/notification",
    ])
  })

  it.each([
    "REDIS_URL",
    "S3_FILE_URL",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_REGION",
    "S3_BUCKET",
    "SENDGRID_API_KEY",
    "SENDGRID_FROM",
  ])("fails closed when %s is absent", (name) => {
    const env = Object.fromEntries(
      Object.entries(productionEnv).filter(([key]) => key !== name),
    ) as NodeJS.ProcessEnv
    expect(() => buildProductionInfrastructureModules(env)).toThrow(
      `${name} must be configured in production`,
    )
  })

  it("rejects an ambiguous S3 path-style value", () => {
    expect(() =>
      buildProductionInfrastructureModules({
        ...productionEnv,
        S3_FORCE_PATH_STYLE: "sometimes",
      }),
    ).toThrow("S3_FORCE_PATH_STYLE must be either true or false")
  })
})
