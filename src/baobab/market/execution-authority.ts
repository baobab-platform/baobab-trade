/**
 * ADR-0010 §§6–7, 27, 43, 62–64, 91–94; MKT-COM-010–018/022.
 *
 * Control Plane owns Market, tenant, and legal seller. A country-selected
 * PlatformContext describes the PRIMARY market participation for that
 * country; it is not authority to select a different market sharing the
 * same country, currency, Medusa Region or Sales Channel.
 *
 * This is a defence-in-depth *consumer* guard for a CP-resolved path, not
 * an IAM credential verifier or a replacement for capability/estate binding.
 */
import type { BaobabMarket } from "../contracts/market"
import type { RawPlatformContextResolutionResponse } from "../contracts/platform-context"
import type { BaobabTenantContext } from "../contracts/tenant-context"
import { assertTradeEntitlement } from "../contracts/tenant-context"
import { isCanonicalEntityId } from "../contracts/canonical-mapping"

const CURRENCY = /^[A-Z]{3}$/
const COUNTRY = /^[A-Z]{2}$/
const MAX_FUTURE_CLOCK_SKEW_MS = 5_000

export type AuthorisedMarketExecution = Readonly<{
  marketId: string
  tenantId: string
  contextId: string
  legalSellerCanonicalId: string
  transactionCurrency: string
  countryCode: string
  marketRevision: number
}>

const timestamp = (value: string | null | undefined, field: string): number => {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new Error(`ADR-0010: invalid or missing ${field}`)
  }
  return Date.parse(value)
}

/**
 * Require explicit CP-derived Market identity AND active participation in
 * the same Market. No client-selected market ID, region or ISO currency can
 * change the attested seller or transaction currency.
 */
export function assertAuthorisedMarketExecution(
  tenant: BaobabTenantContext,
  market: BaobabMarket,
  context: RawPlatformContextResolutionResponse,
  requestedMarketId: string,
  nowMs = Date.now(),
): AuthorisedMarketExecution {
  assertTradeEntitlement(tenant)
  if (!requestedMarketId || market.market_id !== requestedMarketId) {
    throw new Error("ADR-0010: CP Market does not match the requested Market")
  }
  if (market.owner_tenant_id !== tenant.tenantId || context.tenant_id !== tenant.tenantId) {
    throw new Error("ADR-0010: Market/Context tenant boundary mismatch")
  }
  // Stored PlatformContext is the primary market resolved by CP. A market
  // from another participation in the SAME country must not inherit it.
  if (!context.market_id || context.market_id !== market.market_id) {
    throw new Error("ADR-0010: CP did not authorise this exact Market")
  }
  if (market.status !== "ACTIVE") {
    throw new Error("ADR-0010: Market is not ACTIVE")
  }
  if (!Number.isSafeInteger(market.revision) || market.revision < 1) {
    throw new Error("ADR-0010: Market has an invalid revision")
  }
  if (!market.legal_entity_id || !isCanonicalEntityId(market.legal_entity_id)) {
    throw new Error("ADR-0010: Market has no canonical Legal Seller")
  }

  const from = timestamp(market.effective_from, "Market effective_from")
  const until = market.effective_to == null
    ? Number.POSITIVE_INFINITY
    : timestamp(market.effective_to, "Market effective_to")
  if (from > nowMs || until <= from || nowMs >= until) {
    throw new Error("ADR-0010: Market is outside its effective window")
  }

  if (!market.default_currency || !CURRENCY.test(market.default_currency)) {
    throw new Error("ADR-0010: Market has no ISO 4217 transaction currency")
  }
  if (
    (market.allowed_currencies !== undefined &&
      market.allowed_currencies !== null &&
      (!market.allowed_currencies.every((code) => CURRENCY.test(code)) ||
        !market.allowed_currencies.includes(market.default_currency))) ||
    context.currency_code !== market.default_currency
  ) {
    throw new Error("ADR-0010: CP Market currency is missing or inconsistent")
  }

  if (!context.country_code || !COUNTRY.test(context.country_code)) {
    throw new Error("ADR-0010: CP market participation country is missing")
  }
  const countries = market.countries ?? []
  const coversCountry =
    market.default_country === context.country_code || countries.includes(context.country_code)
  if (!coversCountry) {
    throw new Error("ADR-0010: CP Market participation is outside its countries")
  }

  const resolvedAt = timestamp(context.resolved_at, "Context resolved_at")
  if (resolvedAt > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error("ADR-0010: CP Context was resolved in the future")
  }
  if (context.expires_at !== undefined) {
    const expiresAt = timestamp(context.expires_at, "Context expires_at")
    if (expiresAt <= nowMs || expiresAt <= resolvedAt) {
      throw new Error("ADR-0010: CP Context has expired")
    }
  }

  if (!context.context_id) {
    throw new Error("ADR-0010: CP Context identity is missing")
  }
  return {
    marketId: market.market_id,
    tenantId: tenant.tenantId,
    contextId: context.context_id,
    legalSellerCanonicalId: market.legal_entity_id,
    transactionCurrency: market.default_currency,
    countryCode: context.country_code,
    marketRevision: market.revision,
  }
}
