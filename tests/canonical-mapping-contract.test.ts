import { describe, expect, it } from "vitest"
import {
  isCanonicalEntityId,
  isEngineId,
  isExternalReferenceResolution,
  isOpaqueContextId,
  isSystemNamespace,
  isValidMappingResolutionResponse,
  type MappingResolutionResponse,
} from "../src/baobab/contracts/canonical-mapping"

describe("canonical mapping contract", () => {
  const response = {
    context_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b",
    tenant_id: "tn_zuribeans",
    mapping_id: "map_zuribeansmarket",
    canonical_entity_id: "zuribeans_za_b2b",
    external_reference_id: "ref_medusaregion",
    status: "ACTIVE",
    resolution_reason: "scope_matched",
    effective_timestamp: "2026-09-07T10:00:00Z",
    mapping_version: 3,
    resolved_at: "2026-09-07T10:00:01Z",
  }

  it("accepts opaque canonical IDs without deriving business identity from them", () => {
    expect(isCanonicalEntityId("ZURIBEANS-ZA")).toBe(true)
    expect(isCanonicalEntityId("estate:zuribeans-b2b")).toBe(true)
    expect(isCanonicalEntityId("not valid/id")).toBe(false)
  })

  it("requires an ACTIVE mapping that names the context and tenant it resolved in", () => {
    expect(isValidMappingResolutionResponse(response)).toBe(true)
    expect(isValidMappingResolutionResponse({ ...response, status: "DRAFT" })).toBe(false)
    for (const field of [
      "context_id",
      "tenant_id",
      "mapping_version",
      "resolved_at",
      "effective_timestamp",
    ] as const) {
      expect(isValidMappingResolutionResponse({ ...response, [field]: undefined })).toBe(false)
    }
    expect(isValidMappingResolutionResponse({ ...response, tenant_id: "zuribeans" })).toBe(false)
    expect(isValidMappingResolutionResponse({ ...response, mapping_version: 1.5 })).toBe(false)
  })

  it("requires exactly one of external_reference_id and target_canonical_entity_id (ADR-SHARED-014 section 4)", () => {
    expect(
      isValidMappingResolutionResponse({ ...response, external_reference_id: undefined }),
    ).toBe(false)
    expect(
      isValidMappingResolutionResponse({
        ...response,
        target_canonical_entity_id: "estate:zuribeans-b2b",
      }),
    ).toBe(false)

    const canonicalToCanonical = {
      ...response,
      external_reference_id: undefined,
      target_canonical_entity_id: "estate:zuribeans-b2b",
    }
    expect(isValidMappingResolutionResponse(canonicalToCanonical)).toBe(true)
    expect(
      isExternalReferenceResolution(canonicalToCanonical as unknown as MappingResolutionResponse),
    ).toBe(false)
    expect(isExternalReferenceResolution(response as unknown as MappingResolutionResponse)).toBe(
      true,
    )
  })

  it("validates the grammars of the identifiers a request names", () => {
    expect(isOpaqueContextId("0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b")).toBe(true)
    expect(isOpaqueContextId("")).toBe(false)
    expect(isOpaqueContextId("has space")).toBe(false)
    expect(isSystemNamespace("medusa")).toBe(true)
    expect(isSystemNamespace("Medusa")).toBe(false)
    expect(isEngineId("baobab-trade")).toBe(true)
    expect(isEngineId("baobab_trade")).toBe(false)
  })
})
