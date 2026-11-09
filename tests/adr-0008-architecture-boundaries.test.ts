import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(path, "utf8")

const typescriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return typescriptFiles(path)
    return entry.isFile() && path.endsWith(".ts") ? [path] : []
  })

/**
 * ADR-0008 §§4, 7, 21, 36, 119–120: prevent accidental, unauthorised
 * cross-engine database integration. A PostgreSQL client inside Trade for
 * Trade-owned tables is allowed; ERP/CP/CMS private SQL connections are not.
 */
describe("ADR-0008 cross-engine architectural drift gates", () => {
  it("does not import external engine database drivers directly", () => {
    const manifest = JSON.parse(source("package.json")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }
    for (const driver of ["oracledb", "mysql2", "mssql", "tedious", "pg-promise"]) {
      expect(declared, driver).not.toHaveProperty(driver)
    }
  })

  it("does not take other engines' database connection URLs through Trade adapters", () => {
    const integrationScopes = [
      "src/baobab/control-plane",
      "src/baobab/erp-integration",
      "src/baobab/thamani/erp-integration",
    ]
    const externalDatabaseUrl =
      /\b(?:ERP|IDEMPIERE|PAYLOAD|CMS|CONTROL_PLANE|BAOBAB_CP)_(?:DB|DATABASE)_(?:URL|URI|DSN)\b/i

    for (const directory of integrationScopes) {
      for (const file of typescriptFiles(directory)) {
        expect(source(file), file).not.toMatch(externalDatabaseUrl)
      }
    }
  })

  it("fails at startup before registering modules or emitting telemetry", () => {
    const config = source("medusa-config.ts")
    const loaded = config.indexOf("loadEnv(process.env.NODE_ENV")
    const validated = config.indexOf("validateTradeStartupConfiguration(process.env)")
    const tracing = config.indexOf("startTradeOTel()")
    expect(loaded).toBeGreaterThan(-1)
    expect(validated).toBeGreaterThan(loaded)
    expect(tracing).toBeGreaterThan(validated)
  })

  it("keeps required runtime dependencies explicit without cross-engine database credentials", () => {
    const requirements = source("runtime/requirements.yaml")
    expect(requirements).toContain("Do not share databases")
    expect(requirements).toMatch(/postgresql:\s*\n\s*required: true/)
    expect(requirements).toMatch(/control_plane:\s*\n\s*required: true/)
    expect(requirements).not.toMatch(/IDEMPIERE_(?:DB|DATABASE)_URL/)
  })

  it("documents the stable non-replica instance identity in the environment contract", () => {
    const example = source(".env.example")
    for (const key of [
      "BAOBAB_TRADE_ENGINE_INSTANCE_ID=",
      "BAOBAB_ENVIRONMENT=",
      "BAOBAB_REGION=",
      "BAOBAB_DEPLOYMENT_REVISION=",
    ]) {
      expect(example).toContain(key)
    }
  })
})
