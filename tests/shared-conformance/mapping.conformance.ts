import { afterEach, describe, expect, it, vi } from "vitest"
import { HttpControlPlaneClient } from "../../src/baobab/control-plane/client"
import { isValidMappingResolutionResponse } from "../../src/baobab/contracts/canonical-mapping"
import { readJson, validatorFor } from "./shared"

const SCHEMA = "contracts/control-plane/v1/canonical-mapping.schema.json"
const requestSchema = validatorFor(SCHEMA, "resolutionRequest")
const responseSchema = validatorFor(SCHEMA, "resolutionResponse")
const example = readJson("contracts/control-plane/v1/examples/mapping-resolution.json")

const client = () =>
  new HttpControlPlaneClient({
    baseUrl: "http://control-plane.test",
    contextPath: "/v1/context/resolve",
    productId: "baobab-trade",
  })

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

afterEach(() => vi.unstubAllGlobals())

describe("mapping resolution request (ADR-SHARED-014)", () => {
  it("the request Trade's client sends conforms to resolutionRequest", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, example.resolution_response))
    vi.stubGlobal("fetch", fetchMock)

    await client().resolveMapping(example.resolution_request, "token", "corr-1")

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(requestSchema(sent), JSON.stringify(requestSchema.errors)).toBe(true)
    expect(sent).toEqual(example.resolution_request)
  })

  it("the schema rejects what Trade no longer sends (inline context, target_capability)", () => {
    const legacy = {
      canonical_entity_id: example.resolution_request.canonical_entity_id,
      target_capability: "commerce.market",
      target_system: "medusa",
      context: { tenant_id: "tn_abc123" },
    }
    expect(requestSchema(legacy)).toBe(false)
  })
})

describe("mapping resolution response", () => {
  const base = example.resolution_response as Record<string, unknown>
  const canonical = example.canonical_resolution_response as Record<string, unknown>

  /**
   * `schema` is the contract's verdict, asserted from the real schema so a
   * fixture cannot drift from it. `trade` is the verdict of Trade's validator.
   * They agree, except where listed with a reason.
   */
  const cases: Array<{
    name: string
    payload: Record<string, unknown>
    schema: boolean
    trade: boolean
  }> = [
    { name: "Shared's example (native object)", payload: base, schema: true, trade: true },
    {
      name: "Shared's example (canonical to canonical)",
      payload: canonical,
      schema: true,
      trade: true,
    },
    {
      name: "both targets present",
      payload: { ...canonical, external_reference_id: base.external_reference_id },
      schema: false,
      trade: false,
    },
    {
      name: "neither target present",
      payload: { ...base, external_reference_id: undefined },
      schema: false,
      trade: false,
    },
    {
      name: "tenant_id not tn_*",
      payload: { ...base, tenant_id: "zuribeans" },
      schema: false,
      trade: false,
    },
    {
      name: "mapping_id not map_*",
      payload: { ...base, mapping_id: "m1" },
      schema: false,
      trade: false,
    },
    {
      name: "unknown resolution_reason",
      payload: { ...base, resolution_reason: "guess" },
      schema: false,
      trade: false,
    },
    {
      name: "mapping_version not an integer",
      payload: { ...base, mapping_version: 1.5 },
      schema: false,
      trade: false,
    },
    // Documented divergences:
    {
      name: "status DRAFT: contract-valid, but only ACTIVE mappings ever resolve (ADR-SHARED-014 section 2)",
      payload: { ...base, status: "DRAFT" },
      schema: true,
      trade: false,
    },
    {
      name: "extra property: tolerant reader",
      payload: { ...base, added_later: true },
      schema: false,
      trade: true,
    },
  ]

  it.each(cases)("$name", ({ payload, schema, trade }) => {
    expect(responseSchema(payload), JSON.stringify(responseSchema.errors)).toBe(schema)
    expect(isValidMappingResolutionResponse(payload)).toBe(trade)
  })

  it("Trade rejects the loss of every field the contract requires", () => {
    const required = (readJson(SCHEMA).$defs.resolutionResponse.required ?? []) as string[]
    expect(required.length).toBeGreaterThan(0)
    for (const field of required) {
      const payload = { ...base, [field]: undefined }
      expect(responseSchema(payload), `schema must reject missing ${field}`).toBe(false)
      expect(isValidMappingResolutionResponse(payload), `Trade must reject missing ${field}`).toBe(
        false,
      )
    }
  })
})
