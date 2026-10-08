/**
 * Mirrors baobab-platform/shared contracts/control-plane/v1/context-resolution.schema.json
 * (`#/$defs/response`). This is a compatibility adapter, not a competing
 * definition: field names, enums and the fail-closed shape below must track
 * the pinned commit in contracts.lock.yaml.
 */
export type TenantLifecycleStatus =
  | "provisioning"
  | "active"
  | "suspended"
  | "decommissioning"
  | "decommissioned"

export type RawContextResolutionResponse = {
  tenant_id: string
  entity_id: string
  lifecycle_status: TenantLifecycleStatus
  product_id: string
  entitled: true
  entitlement_tier?: string | null
  cache_ttl_seconds: number
  resolved_at: string
  correlation_id: string
}

export type BaobabTenantContext = {
  tenantId: string
  entityId: string
  lifecycleStatus: TenantLifecycleStatus
  productId: string
  entitled: true
  entitlementTier: string | null
  cacheTtlSeconds: number
  resolvedAt: string
  correlationId: string
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

export const lifecycleStatuses: readonly TenantLifecycleStatus[] = [
  "provisioning",
  "active",
  "suspended",
  "decommissioning",
  "decommissioned",
]

export const isValidContextResolutionResponse = (
  candidate: unknown,
): candidate is RawContextResolutionResponse => {
  if (typeof candidate !== "object" || candidate === null) return false
  const value = candidate as Partial<RawContextResolutionResponse>
  return (
    isNonEmptyString(value.tenant_id) &&
    isNonEmptyString(value.entity_id) &&
    typeof value.lifecycle_status === "string" &&
    lifecycleStatuses.includes(value.lifecycle_status) &&
    isNonEmptyString(value.product_id) &&
    value.entitled === true &&
    typeof value.cache_ttl_seconds === "number" &&
    value.cache_ttl_seconds > 0 &&
    isNonEmptyString(value.resolved_at) &&
    isNonEmptyString(value.correlation_id)
  )
}

export const fromContextResolutionResponse = (
  raw: RawContextResolutionResponse,
): BaobabTenantContext => ({
  tenantId: raw.tenant_id,
  entityId: raw.entity_id,
  lifecycleStatus: raw.lifecycle_status,
  productId: raw.product_id,
  entitled: raw.entitled,
  entitlementTier: raw.entitlement_tier ?? null,
  cacheTtlSeconds: raw.cache_ttl_seconds,
  resolvedAt: raw.resolved_at,
  correlationId: raw.correlation_id,
})

export const toContextResolutionResponse = (
  context: BaobabTenantContext,
): RawContextResolutionResponse => ({
  tenant_id: context.tenantId,
  entity_id: context.entityId,
  lifecycle_status: context.lifecycleStatus,
  product_id: context.productId,
  entitled: context.entitled,
  entitlement_tier: context.entitlementTier,
  cache_ttl_seconds: context.cacheTtlSeconds,
  resolved_at: context.resolvedAt,
  correlation_id: context.correlationId,
})

/**
 * Fails closed per contracts.lock.yaml `fail_on_unresolved_tenant_context`.
 * The Control Plane only returns 200 for an active, entitled tenant, so a
 * non-conforming context here indicates a contract drift, not a business state.
 */
export const assertTradeEntitlement = (context: BaobabTenantContext): BaobabTenantContext => {
  if (context.lifecycleStatus !== "active") {
    throw new Error(`Tenant context is not active: ${context.lifecycleStatus}`)
  }

  if (context.entitled !== true) {
    throw new Error("Tenant context is not entitled to Baobab Trade")
  }

  return context
}
