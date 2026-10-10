/**
 * Mirrors baobab-platform/shared
 * contracts/control-plane/v1/platform-context.schema.json (`#/$defs/PlatformContext`),
 * the response of baobab-cp's POST /v1/platform-context/resolve. The Control
 * Plane persists the resolved context and returns its `context_id`, which a
 * workload redeems for mapping and capability resolution (ADR-SHARED-014).
 * Trade is a tolerant reader: it checks the fields it relies on and ignores
 * additions.
 */
export type RawPlatformContextResolutionResponse = {
  context_id: string
  tenant_id: string
  resolved_at: string
  expires_at?: string
  country_code?: string
  market_id?: string
  currency_code?: string
  organisation_id?: string
  organisation_type?: string
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isOptionalMatch = (value: unknown, pattern: RegExp): boolean =>
  value === undefined || (typeof value === "string" && pattern.test(value))
const isDateTime = (value: unknown): boolean =>
  typeof value === "string" && !Number.isNaN(Date.parse(value))

export const isValidPlatformContextResolutionResponse = (
  candidate: unknown,
): candidate is RawPlatformContextResolutionResponse => {
  if (typeof candidate !== "object" || candidate === null) return false
  const value = candidate as Partial<RawPlatformContextResolutionResponse>
  const hasOrganisationId = value.organisation_id !== undefined
  const hasOrganisationType = value.organisation_type !== undefined
  return (
    typeof value.context_id === "string" &&
    uuid.test(value.context_id) &&
    // domain.schema.json#/$defs/tenantId
    typeof value.tenant_id === "string" &&
    /^tn_[a-z0-9]{3,60}$/.test(value.tenant_id) &&
    isDateTime(value.resolved_at) &&
    (value.expires_at === undefined || isDateTime(value.expires_at)) &&
    isOptionalMatch(value.market_id, /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/) &&
    isOptionalMatch(value.country_code, /^[A-Z]{2}$/) &&
    isOptionalMatch(value.currency_code, /^[A-Z]{3}$/) &&
    hasOrganisationId === hasOrganisationType &&
    (!hasOrganisationId ||
      (isNonEmptyString(value.organisation_id) && isNonEmptyString(value.organisation_type)))
  )
}
