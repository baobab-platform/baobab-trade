/**
 * Mirrors baobab-platform/shared contracts/control-plane/v1/market.schema.json.
 *
 * Baobab Market is a Control Plane canonical concept (ADR-0010, "MedusaJS
 * Commerce Market, Region, Currency, Sales Channel and Legal Seller Model").
 * Trade reads Market configuration through the Control Plane API and never
 * mints, authors or redefines a Market as a local concept. A Medusa Region,
 * Sales Channel or Stock Location is Trade's local *projection* of a Market,
 * tracked back to it through an engine-native mapping (see
 * src/baobab/market/mapping.ts), never treated as identical to it.
 */
export const MARKET_STATUSES = [
  "DRAFT",
  "VALIDATED",
  "ACTIVE",
  "DEPRECATED",
  "SUSPENDED",
  "MIGRATING",
  "RETIRED",
] as const
export type MarketStatus = (typeof MARKET_STATUSES)[number]

export const MARKET_TYPES = [
  "B2B",
  "B2C",
  "WHOLESALE",
  "DISTRIBUTOR",
  "INSTITUTIONAL",
  "CORPORATE",
  "RETAIL",
  "MARKETPLACE",
  "OTHER",
] as const
export type MarketType = (typeof MARKET_TYPES)[number]

export type BaobabMarket = {
  market_id: string
  canonical_key: string
  name: string
  owner_tenant_id: string
  legal_entity_id?: string | null
  operating_region_id?: string | null
  parent_market_id?: string | null
  market_type: MarketType
  default_country?: string | null
  countries?: readonly string[] | null
  default_currency?: string | null
  allowed_currencies?: readonly string[] | null
  tax_profile_id?: string | null
  pricing_policy_id?: string | null
  catalogue_policy_id?: string | null
  payment_policy_id?: string | null
  fulfilment_policy_id?: string | null
  regulatory_profile_id?: string | null
  status: MarketStatus
  effective_from: string
  effective_to?: string | null
  revision: number
  /** Set by the Control Plane when it activates the Market (market.schema.json, additive since Shared 2da1a42). */
  activated_at?: string | null
  activated_by?: string | null
  /** Findings from the last Market validation (additive since Shared 2da1a42); informational for Trade. */
  validation_findings?: ReadonlyArray<{ code: string; message: string; field?: string }> | null
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

export const isValidMarket = (candidate: unknown): candidate is BaobabMarket => {
  if (typeof candidate !== "object" || candidate === null) return false
  const value = candidate as Partial<BaobabMarket>
  return (
    isNonEmptyString(value.market_id) &&
    isNonEmptyString(value.canonical_key) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.owner_tenant_id) &&
    isNonEmptyString(value.market_type) &&
    isNonEmptyString(value.status) &&
    typeof value.revision === "number"
  )
}

/**
 * A Market is only safe to transact against once Control Plane has activated
 * it. DRAFT/VALIDATED/SUSPENDED/MIGRATING/RETIRED/DEPRECATED markets must not
 * accept new commerce (ADR-0010 §53-§54).
 */
export const assertMarketTransactable = (market: BaobabMarket): BaobabMarket => {
  if (market.status !== "ACTIVE") {
    throw new Error(`Market ${market.canonical_key} is not ACTIVE: ${market.status}`)
  }
  return market
}
