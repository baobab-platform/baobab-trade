/**
 * Mirrors the subset of baobab-platform/shared
 * contracts/control-plane/v1/canonical-mapping.schema.json that Trade needs
 * to describe its own engine-native projections of canonical entities
 * (Markets, Legal Entities) onto Medusa records (Region, Sales Channel,
 * Stock Location). The Control Plane remains the mapping authority; Trade
 * does not write to the canonical mapping registry in this phase.
 *
 * Mapping resolution follows ADR-SHARED-014: the caller redeems a
 * `context_id` the Control Plane resolved and stored earlier and never
 * supplies tenant, legal-entity, market or other scope dimensions inline.
 */
export type MappingType =
  | "IDENTITY"
  | "REPRESENTATION"
  | "ORGANISATIONAL"
  | "CONTENT"
  | "COMMERCE"
  | "ERP"
  | "CATALOGUE"
  | "PRICING"
  | "TAX"
  | "WAREHOUSE"
  | "FULFILMENT"
  | "PAYMENT"
  | "DOMAIN"
  | "LOCALE"
  | "CURRENCY"
  | "CHANNEL"
  | "CAPABILITY"
  | "INTEGRATION"
  | "MIGRATION"
  | "ALIAS"
  | "SUCCESSOR"

export type ExternalReference = {
  external_reference_id: string
  system_namespace: string
  engine_id: string
  engine_instance_id?: string | null
  native_entity_type: string
  native_id: string
  native_key?: string | null
  source_authority: "engine" | "external-sync" | "manual-import" | "reconciliation"
  status: "active" | "unverified" | "suspect" | "orphan" | "archived"
}

export type MappingResolutionRequest = {
  /** A context the Control Plane resolved and stored earlier (ADR-SHARED-014). */
  context_id: string
  canonical_entity_id: string
  /** Registered system namespace of the target ExternalReference, e.g. "medusa". */
  target_system_namespace?: string
  /** Registered engine of the target ExternalReference, e.g. "baobab-trade". */
  target_engine_id?: string
  effective_timestamp?: string
}

export type MappingResolutionReason =
  | "active_binding"
  | "scope_matched"
  | "temporal_valid"
  | "priority_applied"
  | "default_mapping"
  | "fallback_applied"

type MappingResolutionBase = {
  context_id: string
  tenant_id: string
  mapping_id: string
  canonical_entity_id: string
  scope_id?: string
  status: "ACTIVE"
  resolution_reason: MappingResolutionReason
  effective_timestamp: string
  mapping_version: number
  resolved_at: string
  cached?: boolean
}

/**
 * Exactly one of `external_reference_id` (the canonical entity resolves to a
 * native object) and `target_canonical_entity_id` (canonical to canonical)
 * is present (ADR-SHARED-014 section 4).
 */
export type MappingResolutionResponse = MappingResolutionBase &
  (
    | { external_reference_id: string; target_canonical_entity_id?: undefined }
    | { target_canonical_entity_id: string; external_reference_id?: undefined }
  )

/** A resolution that names a native object, which is what Trade projects onto Medusa. */
export type ExternalReferenceResolution = Extract<
  MappingResolutionResponse,
  { external_reference_id: string }
>

const resolutionReasons: readonly MappingResolutionReason[] = [
  "active_binding",
  "scope_matched",
  "temporal_valid",
  "priority_applied",
  "default_mapping",
  "fallback_applied",
]

const matches = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value)

const isDateTime = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value))

export const isCanonicalEntityId = (value: unknown): value is string =>
  matches(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/)

/** control-plane/v1 capability-explanation.schema.json#/$defs/opaqueId, the grammar of a context_id. */
export const isOpaqueContextId = (value: unknown): value is string =>
  matches(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)

/** control-plane/v1 canonical-mapping.schema.json externalReference system_namespace. */
export const isSystemNamespace = (value: unknown): value is string =>
  matches(value, /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/) && (value as string).length <= 128

/** control-plane/v1 domain.schema.json#/$defs/engineId. */
export const isEngineId = (value: unknown): value is string =>
  matches(value, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/) &&
  (value as string).length >= 3 &&
  (value as string).length <= 63

export const isValidMappingResolutionResponse = (
  candidate: unknown,
): candidate is MappingResolutionResponse => {
  if (typeof candidate !== "object" || candidate === null) return false
  const value = candidate as Record<string, unknown>
  const hasExternalReference = value.external_reference_id !== undefined
  const hasTargetEntity = value.target_canonical_entity_id !== undefined
  return (
    isOpaqueContextId(value.context_id) &&
    matches(value.tenant_id, /^tn_[a-z0-9]{3,60}$/) &&
    matches(value.mapping_id, /^map_[a-z0-9]{4,59}$/) &&
    isCanonicalEntityId(value.canonical_entity_id) &&
    // exactly one of the two targets (ADR-SHARED-014 section 4)
    hasExternalReference !== hasTargetEntity &&
    (!hasExternalReference || matches(value.external_reference_id, /^ref_[a-z0-9]{4,59}$/)) &&
    (!hasTargetEntity || isCanonicalEntityId(value.target_canonical_entity_id)) &&
    // only an ACTIVE mapping ever resolves (ADR-SHARED-014 section 2)
    value.status === "ACTIVE" &&
    typeof value.resolution_reason === "string" &&
    (resolutionReasons as readonly string[]).includes(value.resolution_reason) &&
    isDateTime(value.effective_timestamp) &&
    Number.isInteger(value.mapping_version) &&
    isDateTime(value.resolved_at)
  )
}

export const isExternalReferenceResolution = (
  resolution: MappingResolutionResponse,
): resolution is ExternalReferenceResolution => typeof resolution.external_reference_id === "string"

/**
 * A breadcrumb Trade attaches to a Medusa record's own `metadata` so a
 * bootstrap run can detect what it already provisioned (idempotency) and so
 * a reconciliation job can find it later. This is deliberately NOT the
 * canonical mapping record itself (that is minted and owned by Control
 * Plane once published) — see docs/architecture/market-model.md.
 */
export type EngineNativeMappingTag = {
  baobab_mapping_type: Extract<MappingType, "COMMERCE" | "CHANNEL" | "WAREHOUSE">
  baobab_market_key: string
  baobab_mapping_authority: "trade-engine-native-pending-control-plane-registration"
}

export const buildEngineNativeMappingTag = (
  mappingType: EngineNativeMappingTag["baobab_mapping_type"],
  marketKey: string,
): EngineNativeMappingTag => ({
  baobab_mapping_type: mappingType,
  baobab_market_key: marketKey,
  baobab_mapping_authority: "trade-engine-native-pending-control-plane-registration",
})

export const readMarketKeyFromMetadata = (
  metadata: Record<string, unknown> | null | undefined,
): string | null => {
  const value = metadata?.baobab_market_key
  return typeof value === "string" && value.trim().length > 0 ? value : null
}
