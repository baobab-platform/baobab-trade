import { afterEach, describe, expect, it, vi } from "vitest"
import { HttpControlPlaneClient } from "../../src/baobab/control-plane/client"
import { isValidMarket, MARKET_STATUSES, MARKET_TYPES } from "../../src/baobab/contracts/market"
import { isProblemDetails } from "../../src/baobab/contracts/problem-details"
import { isValidPlatformContextResolutionResponse } from "../../src/baobab/contracts/platform-context"
import {
  isValidContextResolutionResponse,
  lifecycleStatuses,
} from "../../src/baobab/contracts/tenant-context"
import { readJson, validatorFor } from "./shared"

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const client = () =>
  new HttpControlPlaneClient({
    baseUrl: "http://control-plane.test",
    contextPath: "/v1/context/resolve",
    productId: "baobab-trade",
  })

afterEach(() => vi.unstubAllGlobals())

describe("platform context (POST /platform-context/resolve)", () => {
  const SCHEMA = "contracts/control-plane/v1/platform-context.schema.json"
  const requestSchema = validatorFor(SCHEMA, "PlatformContextResolveRequest")
  const contextSchema = validatorFor(SCHEMA, "PlatformContext")
  const example = readJson("contracts/control-plane/v1/examples/platform-context.json")

  it("the stored-context request Trade sends conforms to the request schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, example.context))
    vi.stubGlobal("fetch", fetchMock)

    await client().resolveStoredContext("token", "corr-1", {
      tenantId: example.context.tenant_id,
      countryCode: "UG",
    })

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(requestSchema(sent), JSON.stringify(requestSchema.errors)).toBe(true)
    // An empty body is also valid: a workload token may carry its own tenant.
    expect(requestSchema({})).toBe(true)
  })

  it("the organisation-attestation request Trade sends conforms to the request schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, example.context))
    vi.stubGlobal("fetch", fetchMock)

    await client().resolvePlatformContext(
      example.context.tenant_id,
      example.context.organisation_id,
      "token",
      "corr-1",
      "BUYER_ORGANISATION",
    )

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(requestSchema(sent), JSON.stringify(requestSchema.errors)).toBe(true)
  })

  it("accepts Shared's example context", () => {
    expect(contextSchema(example.context), JSON.stringify(contextSchema.errors)).toBe(true)
    expect(isValidPlatformContextResolutionResponse(example.context)).toBe(true)
  })

  it("rejects the loss of every field the contract requires", () => {
    const required = readJson(SCHEMA).$defs.PlatformContext.required as string[]
    expect(required).toEqual(expect.arrayContaining(["context_id", "tenant_id", "resolved_at"]))
    for (const field of required) {
      const payload = { ...example.context, [field]: undefined }
      expect(contextSchema(payload), `schema must reject missing ${field}`).toBe(false)
      expect(
        isValidPlatformContextResolutionResponse(payload),
        `Trade must reject missing ${field}`,
      ).toBe(false)
    }
  })

  it.each([
    {
      name: "context_id not a UUID",
      patch: { context_id: "ctx_abc" },
      schema: false,
      trade: false,
    },
    {
      name: "market_id not the market grammar",
      patch: { market_id: "Market 1" },
      schema: false,
      trade: false,
    },
    { name: "country_code lower case", patch: { country_code: "ug" }, schema: false, trade: false },
    {
      name: "currency_code wrong length",
      patch: { currency_code: "UG" },
      schema: false,
      trade: false,
    },
    // Documented divergences:
    {
      name: "organisation_id without organisation_type (Trade requires the pair)",
      patch: { organisation_type: undefined },
      schema: true,
      trade: false,
    },
    {
      name: "extra property: tolerant reader",
      patch: { added_later: 1 },
      schema: false,
      trade: true,
    },
  ])("$name", ({ patch, schema, trade }) => {
    const payload = { ...example.context, ...patch }
    expect(contextSchema(payload), JSON.stringify(contextSchema.errors)).toBe(schema)
    expect(isValidPlatformContextResolutionResponse(payload)).toBe(trade)
  })
})

describe("tenant context (POST /context/resolve)", () => {
  const schema = validatorFor(
    "contracts/control-plane/v1/context-resolution.schema.json",
    "response",
  )
  const example = readJson("contracts/control-plane/v1/examples/resolve-context.json")

  it("accepts Shared's example response", () => {
    expect(schema(example.response), JSON.stringify(schema.errors)).toBe(true)
    expect(isValidContextResolutionResponse(example.response)).toBe(true)
  })

  it("Trade's lifecycle statuses are exactly the contract's", () => {
    const contract = readJson("contracts/control-plane/v1/context-resolution.schema.json")
    const statuses = contract.$defs.response.properties.lifecycle_status.enum as string[]
    expect([...lifecycleStatuses].sort()).toEqual([...statuses].sort())
  })

  it("rejects the loss of every field the contract requires", () => {
    const contract = readJson("contracts/control-plane/v1/context-resolution.schema.json")
    for (const field of contract.$defs.response.required as string[]) {
      const payload = { ...example.response, [field]: undefined }
      expect(schema(payload), `schema must reject missing ${field}`).toBe(false)
      expect(isValidContextResolutionResponse(payload), `Trade must reject missing ${field}`).toBe(
        false,
      )
    }
  })
})

describe("market (GET /markets/{market_id})", () => {
  const SCHEMA = "contracts/control-plane/v1/market.schema.json"
  const marketSchema = validatorFor(SCHEMA, "market")
  const example = readJson("contracts/control-plane/v1/examples/market.json")

  it("Trade's Market enums are exactly the contract's", () => {
    const defs = readJson(SCHEMA).$defs
    expect([...MARKET_STATUSES].sort()).toEqual([...defs.market.properties.status.enum].sort())
    expect([...MARKET_TYPES].sort()).toEqual([...defs.marketType.enum].sort())
  })

  it("accepts every Market state Shared's example publishes", () => {
    const states = Object.entries(example).filter(
      ([, value]) => typeof value === "object" && value !== null && "market_id" in value,
    )
    expect(states.length).toBeGreaterThan(0)
    for (const [name, market] of states) {
      expect(marketSchema(market), `${name}: ${JSON.stringify(marketSchema.errors)}`).toBe(true)
      expect(isValidMarket(market), `${name} must be accepted by Trade`).toBe(true)
    }
  })

  it("rejects the loss of every field Trade relies on, and the contract requires", () => {
    const [, market] = Object.entries(example).find(
      ([, value]) => typeof value === "object" && value !== null && "market_id" in value,
    ) as [string, Record<string, unknown>]
    for (const field of [
      "market_id",
      "canonical_key",
      "name",
      "owner_tenant_id",
      "market_type",
      "status",
    ]) {
      const payload = { ...market, [field]: undefined }
      expect(marketSchema(payload), `schema must reject missing ${field}`).toBe(false)
      expect(isValidMarket(payload), `Trade must reject missing ${field}`).toBe(false)
    }
  })
})

describe("problem details (error responses)", () => {
  const schema = validatorFor("contracts/errors/v1/problem-details.schema.json")
  const problem = {
    type: "https://contracts.baobab-platform.com/errors/context-not-found",
    title: "Context not found",
    status: 404,
    code: "CONTEXT_NOT_FOUND",
    correlation_id: "7c8f131b-d8ba-4d89-b60b-a187d3944074",
    retryable: false,
  }

  it("accepts a conforming problem", () => {
    expect(schema(problem), JSON.stringify(schema.errors)).toBe(true)
    expect(isProblemDetails(problem)).toBe(true)
  })

  it("rejects the loss of every field the contract requires", () => {
    const required = readJson("contracts/errors/v1/problem-details.schema.json")
      .required as string[]
    for (const field of required) {
      const payload = { ...problem, [field]: undefined }
      expect(schema(payload), `schema must reject missing ${field}`).toBe(false)
      expect(isProblemDetails(payload), `Trade must reject missing ${field}`).toBe(false)
    }
  })
})
