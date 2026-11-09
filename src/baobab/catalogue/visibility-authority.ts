/**
 * ADR-0011 §§27–34, 75, 84, 90–92, 95–96; PRD-COM-011/012/022–024.
 *
 * A market_key sent by a browser is selection intent, never permission to
 * discover an organisation's restricted product list. A production provider
 * MUST authenticate the caller through the real IAM/Control Plane buyer
 * context, verify estate–Market eligibility, then apply that organisation's
 * B2B catalogue entitlement to the server-computed eligible candidates.
 *
 * The port is intentionally not bound to an unverified Medusa customer
 * session, hostname, unsigned request header or a local Market bootstrap
 * key. When no connected provider is registered, the Store route is HELD.
 */
import type { MedusaRequest } from "@medusajs/framework/http"

export const PRODUCT_CATALOGUE_ACCESS = "baobab_product_catalogue_access_v1"

export type VerifiedCatalogueAccess = Readonly<{
  tenantId: string
  canonicalMarketId: string
  marketKey: string
  digitalEstateId: string
  buyerPrincipalId: string
  canonicalBuyerOrganisationId: string
  expiresAt: string
}>

export interface ProductCatalogueAccessPort {
  /**
   * Verify the actual caller and estate through IAM/CP. The requested key is
   * UNTRUSTED. Return a server-resolved, current buyer-specific Market scope.
   */
  authorizeRequest(
    request: MedusaRequest,
    requestedMarketKey: string,
  ): Promise<VerifiedCatalogueAccess>

  /**
   * Server-side B2B visibility decision. Must not return an ID belonging to
   * another buyer, or any ID absent from the already-cleared candidate set.
   */
  visibleProductIds(
    access: VerifiedCatalogueAccess,
    marketEligibleProductIds: readonly string[],
  ): Promise<readonly string[]>
}

const isNonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

const MARKET_ID = /^mkt_[a-z0-9_]{3,60}$/
const TENANT_ID = /^tn_[a-z0-9]{3,60}$/

export function assertVerifiedCatalogueAccess(
  access: VerifiedCatalogueAccess,
  requestedMarketKey: string,
  now: number = Date.now(),
): VerifiedCatalogueAccess {
  if (
    !isNonEmpty(requestedMarketKey) ||
    !access ||
    access.marketKey !== requestedMarketKey ||
    !MARKET_ID.test(access.canonicalMarketId) ||
    !TENANT_ID.test(access.tenantId) ||
    !isNonEmpty(access.digitalEstateId) ||
    !isNonEmpty(access.buyerPrincipalId) ||
    !isNonEmpty(access.canonicalBuyerOrganisationId)
  ) {
    throw new Error("ADR-0011: catalogue buyer or Market is not authorised")
  }
  const expiresAt = Date.parse(access.expiresAt)
  if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error("ADR-0011: catalogue buyer authority is expired or invalid")
  }
  return access
}

/** A bad or overbroad entitlement-provider result MUST NOT reach a Store API. */
export function assertVisibleProductSubset(
  eligible: readonly string[],
  visible: readonly string[],
): string[] {
  if (!Array.isArray(visible) || visible.length > eligible.length) {
    throw new Error("ADR-0011: invalid catalogue entitlement response")
  }
  const allowed = new Set(eligible)
  const result = new Set<string>()
  for (const id of visible) {
    if (!isNonEmpty(id) || !allowed.has(id) || result.has(id)) {
      throw new Error("ADR-0011: cross-catalogue product disclosure refused")
    }
    result.add(id)
  }
  return [...result]
}
