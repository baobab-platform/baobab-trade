import type { RawPlatformContextResolutionResponse } from "../contracts/platform-context"

/**
 * LA-05C4: fail-closed on a tenant-wide CP attestation with no explicit
 * market/currency. A valid tenant+Organisation association alone does NOT
 * authorise a country-specific checkout, legal actor or merchant.
 */
export type ExpectedSellerContext = {
  tenantId: string
  organisationId: string
  marketCode: string
  currencyCode: string
}
export function assertCurrentSellerMarketContext(
  result: RawPlatformContextResolutionResponse,
  expected: ExpectedSellerContext,
  nowMs: number,
): void {
  if (
    !result ||
    result.tenant_id !== expected.tenantId ||
    result.organisation_id !== expected.organisationId ||
    result.country_code !== expected.marketCode ||
    result.currency_code !== expected.currencyCode
  ) {
    throw new Error("LA-05C4 denied: missing or conflicting CP market/Organisation/currency")
  }
  const resolved = Date.parse(result.resolved_at)
  const expiry = result.expires_at ? Date.parse(result.expires_at) : Number.POSITIVE_INFINITY
  if (
    !Number.isFinite(resolved) ||
    resolved > nowMs + 1000 ||
    resolved < nowMs - 30_000 ||
    !(expiry > nowMs)
  ) {
    throw new Error("LA-05C4 denied: CP platform context is stale")
  }
}
