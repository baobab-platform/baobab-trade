import { afterEach, describe, expect, it, vi } from "vitest"
import { TRADE_MEDUSA_TARGET } from "../../src/baobab/context/resolver"
import { HttpControlPlaneClient } from "../../src/baobab/control-plane/client"
import { readYaml } from "./shared"

type Operation = { security?: Array<Record<string, string[]>> }
const openapi = readYaml("contracts/control-plane/v1/openapi.yaml") as {
  servers: Array<{ url: string }>
  paths: Record<string, Record<string, Operation>>
}
const registry = readYaml("contracts/identity/v1/workload-registry.yaml").workloads as Record<
  string,
  { allowed_scopes: string[]; allowed_audiences: string[]; status: string }
>
const systems = readYaml("contracts/control-plane/v1/external-systems.yaml").systems as Array<{
  system_namespace: string
  engine_ids: string[]
}>

const BASE = "http://control-plane.test"
const serverPrefix = new URL(openapi.servers[0].url).pathname.replace(/\/$/, "") // "/v1"

/**
 * Operations that the CP "market:read" and "mapping:resolve" scopes guard are
 * called by Trade's client but are NOT among the scopes the registry grants
 * baobab-trade-workload (context:resolve, provider-migration:task). Nothing
 * calls them in production yet (resolveCommerceContext is not wired to a
 * route), so nothing fails today; the first caller would get 403.
 *
 * Granting a workload scope is an authority decision for the owners (Shared
 * workload-registry.yaml, the IAM client and the Control Plane registry), not a
 * compatibility fix. This list pins the gap so it cannot change unnoticed:
 * the test fails if a NEW unregistered scope appears, and also when the gap is
 * closed, so this entry is then deleted.
 */
const KNOWN_UNREGISTERED_SCOPES = ["mapping:resolve", "market:read"]

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

afterEach(() => vi.unstubAllGlobals())

const templateToRegExp = (template: string): RegExp =>
  new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`)

/** The operation (path template + method) a captured request addresses, per the OpenAPI. */
const operationFor = (url: string, method: string) => {
  const path = new URL(url).pathname
  expect(
    path.startsWith(serverPrefix + "/"),
    `${path} is under the server base ${serverPrefix}`,
  ).toBe(true)
  const relative = path.slice(serverPrefix.length)
  const template = Object.keys(openapi.paths).find((candidate) =>
    templateToRegExp(candidate).test(relative),
  )
  expect(template, `${method} ${path} is an operation in openapi.yaml`).toBeDefined()
  const operation = openapi.paths[template as string][method.toLowerCase()]
  expect(operation, `${method} ${template} is defined`).toBeDefined()
  return { template: template as string, operation }
}

/** Calls each Control Plane method Trade's client has and records the request it made. */
const captureClientRequests = async () => {
  const calls: Array<{ name: string; url: string; method: string }> = []
  let current = ""
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init: RequestInit) => {
      calls.push({ name: current, url, method: init.method ?? "GET" })
      return Promise.resolve(jsonResponse(503, {}))
    }),
  )
  const client = new HttpControlPlaneClient({
    baseUrl: BASE,
    contextPath: "/v1/context/resolve",
    productId: "baobab-trade",
  })
  const invoke = async (name: string, call: () => Promise<unknown>) => {
    current = name
    await call().catch(() => undefined) // the stub answers 503; only the request matters
  }
  const contextId = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b"
  await invoke("resolveContext", () => client.resolveContext("token", "corr-1"))
  await invoke("getMarket", () => client.getMarket("mkt_abc123", "token", "corr-1"))
  await invoke("resolveMapping", () =>
    client.resolveMapping(
      { context_id: contextId, canonical_entity_id: "mkt_abc123" },
      "token",
      "corr-1",
    ),
  )
  await invoke("resolveStoredContext", () => client.resolveStoredContext("token", "corr-1"))
  await invoke("resolvePlatformContext", () =>
    client.resolvePlatformContext(
      "tn_abc123",
      "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c",
      "token",
      "corr-1",
    ),
  )
  return calls
}

describe("Control Plane operations Trade's client calls", () => {
  it("every request addresses an operation that exists in openapi.yaml, with the right method", async () => {
    const calls = await captureClientRequests()
    expect(calls.map((call) => call.name)).toEqual([
      "resolveContext",
      "getMarket",
      "resolveMapping",
      "resolveStoredContext",
      "resolvePlatformContext",
    ])
    for (const call of calls) operationFor(call.url, call.method)
  })

  it("the scopes those operations require, less the scopes the registry grants Trade, are exactly the known gap", async () => {
    const granted = new Set(registry["baobab-trade-workload"].allowed_scopes)
    const required = new Set<string>()
    for (const call of await captureClientRequests()) {
      const { operation } = operationFor(call.url, call.method)
      for (const requirement of operation.security ?? []) {
        for (const scope of requirement.workloadOidc ?? []) required.add(scope)
      }
    }
    const unregistered = [...required].filter((scope) => !granted.has(scope)).sort()
    expect(unregistered).toEqual(KNOWN_UNREGISTERED_SCOPES)
  })

  it("the Trade workload is ACTIVE and audience-scoped to the Control Plane", () => {
    const trade = registry["baobab-trade-workload"]
    expect(trade.status).toBe("ACTIVE")
    expect(trade.allowed_audiences).toContain("baobab-control-plane")
  })
})

describe("mapping targets", () => {
  it("(medusa, baobab-trade) is a registered external system pair", () => {
    const medusa = systems.find(
      (system) => system.system_namespace === TRADE_MEDUSA_TARGET.target_system_namespace,
    )
    expect(medusa).toBeDefined()
    expect(medusa?.engine_ids).toContain(TRADE_MEDUSA_TARGET.target_engine_id)
  })
})
