import { describe, expect, it } from "vitest"
import {
  assertTradeEntitlement,
  fromContextResolutionResponse,
  isValidContextResolutionResponse,
  type RawContextResolutionResponse,
} from "../src/baobab/contracts/tenant-context"

const rawActive: RawContextResolutionResponse = {
  tenant_id: "tn_01k4m7x9q2v6c8r3d5f1h0j4",
  entity_id: "ZURIBEANS",
  lifecycle_status: "active",
  product_id: "baobab-trade",
  entitled: true,
  entitlement_tier: null,
  cache_ttl_seconds: 15,
  resolved_at: "2026-09-01T10:00:00Z",
  correlation_id: "7c8f131b-d8ba-4d89-b60b-a187d3944074",
}

describe("Baobab tenant context (context-resolution.schema.json)", () => {
  it("requires the fields mandated by the shared response schema", () => {
    expect(isValidContextResolutionResponse(rawActive)).toBe(true)
    expect(isValidContextResolutionResponse({ ...rawActive, tenant_id: undefined })).toBe(false)
    expect(isValidContextResolutionResponse({ ...rawActive, entity_id: undefined })).toBe(false)
    expect(isValidContextResolutionResponse({ ...rawActive, entitled: false })).toBe(false)
    expect(isValidContextResolutionResponse({ ...rawActive, lifecycle_status: "bogus" })).toBe(
      false,
    )
  })

  it("maps the wire response to the internal camelCase context", () => {
    const context = fromContextResolutionResponse(rawActive)
    expect(context.tenantId).toBe(rawActive.tenant_id)
    expect(context.entityId).toBe(rawActive.entity_id)
    expect(context.cacheTtlSeconds).toBe(15)
  })

  it("fails closed for a non-active lifecycle status", () => {
    const context = fromContextResolutionResponse(rawActive)
    expect(assertTradeEntitlement(context)).toEqual(context)
    expect(() => assertTradeEntitlement({ ...context, lifecycleStatus: "suspended" })).toThrow(
      "not active",
    )
  })
})
