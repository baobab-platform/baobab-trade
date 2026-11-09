import { afterEach, describe, expect, it, vi } from "vitest"
import { getBaobabTradeEnvironment } from "../src/baobab/config/environment"
import {
  readTradeFeatureFlag,
  validateTradeStartupConfiguration,
} from "../src/baobab/config/startup-validation"

const production = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  BAOBAB_TRADE_ENGINE_ID: "baobab-trade",
  BAOBAB_TRADE_ENGINE_INSTANCE_ID: "ei_trade01",
  BAOBAB_ENVIRONMENT: "staging",
  BAOBAB_REGION: "af-south-1",
  BAOBAB_DEPLOYMENT_REVISION: "8a68bcf123456789",
  BAOBAB_CONTROL_PLANE_BASE_URL: "https://cp.example.test",
  DATABASE_URL: "postgresql://user:private@postgres:5432/trade",
  REDIS_URL: "rediss://redis:6379",
  JWT_SECRET: "J".repeat(48),
  COOKIE_SECRET: "C".repeat(48),
  BAOBAB_WEBHOOK_SIGNING_SECRET: "W".repeat(48),
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("ADR-0008 §8–9 production bootstrap and EngineInstance identity", () => {
  it("accepts an explicit stable deployment identity without inventing a replica identity", () => {
    expect(validateTradeStartupConfiguration(production())).toEqual({
      engineId: "baobab-trade",
      engineInstanceId: "ei_trade01",
      environment: "staging",
      region: "af-south-1",
      revision: "8a68bcf123456789",
    })
  })

  it("allows development without production credentials or CP registration", () => {
    expect(validateTradeStartupConfiguration({ NODE_ENV: "test" })).toEqual({
      engineId: "baobab-trade",
      engineInstanceId: undefined,
      environment: undefined,
      region: undefined,
      revision: undefined,
    })
  })

  it.each([
    "BAOBAB_TRADE_ENGINE_ID",
    "BAOBAB_TRADE_ENGINE_INSTANCE_ID",
    "BAOBAB_ENVIRONMENT",
    "BAOBAB_REGION",
    "BAOBAB_DEPLOYMENT_REVISION",
    "BAOBAB_CONTROL_PLANE_BASE_URL",
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "COOKIE_SECRET",
    "BAOBAB_WEBHOOK_SIGNING_SECRET",
  ])("rejects a production runtime without %s", (key) => {
    const env = production()
    delete env[key]
    expect(() => validateTradeStartupConfiguration(env)).toThrow(key)
  })

  it.each([
    ["BAOBAB_TRADE_ENGINE_INSTANCE_ID", "container-17"],
    ["BAOBAB_ENVIRONMENT", "some-market"],
    ["BAOBAB_REGION", "AF SOUTH 1"],
    ["BAOBAB_DEPLOYMENT_REVISION", "unknown"],
    ["BAOBAB_TRADE_ENGINE_ID", "http://trade"],
  ])("rejects untrusted %s values", (key, value) => {
    expect(() => validateTradeStartupConfiguration({ ...production(), [key]: value })).toThrow(key)
  })

  it("distinguishes the Node production runtime from its actual staging deployment", () => {
    expect(
      validateTradeStartupConfiguration({
        ...production(),
        NODE_ENV: "production",
        BAOBAB_ENVIRONMENT: "staging",
      }).environment,
    ).toBe("staging")
  })

  it("rejects non-PostgreSQL URLs and insecure/credentialed production service URLs", () => {
    for (const env of [
      { DATABASE_URL: "mysql://user:private@db/trade" },
      { BAOBAB_CONTROL_PLANE_BASE_URL: "http://cp.example.test" },
      { BAOBAB_CONTROL_PLANE_BASE_URL: "https://actor:secret@cp.example.test" },
      { BAOBAB_CONTROL_PLANE_BASE_URL: "https://cp.example.test/path?token=private" },
    ]) {
      expect(() => validateTradeStartupConfiguration({ ...production(), ...env })).toThrow()
    }
  })

  it("rejects placeholder credentials without including the secret in the error", () => {
    const secret = "change-me-in-secret-manager"
    for (const key of ["JWT_SECRET", "COOKIE_SECRET", "BAOBAB_WEBHOOK_SIGNING_SECRET"]) {
      let error: unknown
      try {
        validateTradeStartupConfiguration({ ...production(), [key]: secret })
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toContain(key)
      expect(String(error)).not.toContain(secret)
    }
  })
})

describe("ADR-0008 §§72–74, 84 feature gates", () => {
  it("accepts only explicit boolean flag values; missing means disabled", () => {
    expect(readTradeFeatureFlag(undefined, "FLAG")).toBe(false)
    expect(readTradeFeatureFlag("false", "FLAG")).toBe(false)
    expect(readTradeFeatureFlag("true", "FLAG")).toBe(true)
    for (const value of ["TRUE", "yes", "1", "", " true "]) {
      expect(() => readTradeFeatureFlag(value, "FLAG")).toThrow("FLAG")
    }
  })

  it("rejects missing IAM and CP dependencies for an enabled buyer path", () => {
    const env = {
      NODE_ENV: "development",
      BAOBAB_BUYER_IDENTITY_ENABLED: "true",
    }
    expect(() => validateTradeStartupConfiguration(env)).toThrow(
      "BAOBAB_CONTROL_PLANE_BASE_URL",
    )

    const enabled = {
      ...production(),
      BAOBAB_BUYER_IDENTITY_ENABLED: "true",
      BAOBAB_IAM_WORKLOAD_TOKEN_URL: "https://iam.example.test/oauth/token",
      BAOBAB_IAM_WORKLOAD_CLIENT_ID: "baobab-trade-workload",
      BAOBAB_IAM_WORKLOAD_CLIENT_SECRET: "synthetic-private-workload-secret",
      BAOBAB_IAM_BUYER_ISSUER: "https://iam.example.test/",
      BAOBAB_IAM_BUYER_AUTHORISED_PARTIES: "zuribeans-bff",
    }
    expect(() => validateTradeStartupConfiguration(enabled)).not.toThrow()
    delete (enabled as NodeJS.ProcessEnv).BAOBAB_IAM_WORKLOAD_CLIENT_SECRET
    expect(() => validateTradeStartupConfiguration(enabled)).toThrow(
      "BAOBAB_IAM_WORKLOAD_CLIENT_SECRET",
    )
  })

  it("refuses to activate development-only resource assignment in production", () => {
    const env = {
      ...production(),
      BAOBAB_ENVIRONMENT: "production",
      BAOBAB_RESOURCE_ASSIGNMENT_ENABLED: "true",
      BAOBAB_IAM_WORKLOAD_TOKEN_URL: "https://iam.example.test/oauth/token",
      BAOBAB_IAM_WORKLOAD_CLIENT_ID: "baobab-trade-workload",
      BAOBAB_IAM_WORKLOAD_CLIENT_SECRET: "synthetic-private-workload-secret",
    }
    expect(() => validateTradeStartupConfiguration(env)).toThrow("not approved for production")
  })

  it("uses strict flag parsing in the existing request-time environment reader", () => {
    vi.stubEnv("BAOBAB_BUYER_IDENTITY_ENABLED", "fales")
    expect(() => getBaobabTradeEnvironment()).toThrow("BAOBAB_BUYER_IDENTITY_ENABLED")
    vi.stubEnv("BAOBAB_BUYER_IDENTITY_ENABLED", "false")
    vi.stubEnv("BAOBAB_RESOURCE_ASSIGNMENT_ENABLED", "enabled")
    expect(() => getBaobabTradeEnvironment()).toThrow("BAOBAB_RESOURCE_ASSIGNMENT_ENABLED")
  })
})
