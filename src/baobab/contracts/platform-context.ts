/**
 * baobab-cp's POST /v1/platform-context/resolve response
 * (api/platform_context_handler.go's platformContextResolveResponse). Unlike
 * tenant-context.ts's RawContextResolutionResponse, this is not a
 * nabhold/shared-published contract yet (grep-confirmed: no
 * contracts/control-plane/v1/platform-context*.schema.json exists at the
 * pinned commit in contracts.lock.yaml) -- this type is Trade's own,
 * maintained against baobab-cp's Go struct directly until one is published.
 */
export type RawPlatformContextResolutionResponse = {
  context_id: string
  tenant_id: string
  resolved_at: string
  expires_at?: string | null
  organisation_id?: string
  organisation_type?: string
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

export const isValidPlatformContextResolutionResponse = (
  candidate: unknown,
): candidate is RawPlatformContextResolutionResponse => {
  if (typeof candidate !== "object" || candidate === null) return false
  const value = candidate as Partial<RawPlatformContextResolutionResponse>
  const hasOrganisationId = value.organisation_id !== undefined
  const hasOrganisationType = value.organisation_type !== undefined
  return (
    isNonEmptyString(value.context_id) &&
    isNonEmptyString(value.tenant_id) &&
    hasOrganisationId === hasOrganisationType &&
    (!hasOrganisationId ||
      (isNonEmptyString(value.organisation_id) &&
        isNonEmptyString(value.organisation_type)))
  )
}
