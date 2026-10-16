/**
 * ADR-SHARED-039 Trade-0: Trade is authoritative for its native seller
 * configuration (the Medusa sales channels and regions a seller operates
 * through) and carries it to CP only as an opaque reference and a SHA-256
 * digest. The digest is computed from LIVE native records, so any drift in a
 * channel or region changes it and every later order-authority request under
 * the old binding is denied (NATIVE_CONFIGURATION_MISMATCH) until Trade
 * re-attests and a new binding version is governed and activated in CP.
 *
 * Nothing here selects a seller, legal entity or mandate, and a digest is
 * never authority.
 */
import { createHash } from "node:crypto"

export const NATIVE_CONFIGURATION_CANONICALIZATION = "baobab-trade/native-seller-configuration/v1"

/** The operator-declared seller operating context; CP verifies its canonical side. */
export type NativeSellerConfigurationScope = {
  reference: string
  tenantId: string
  organisationId: string
  market: string
  engineInstanceId: string
  currencyScope: readonly string[]
  salesChannelIds: readonly string[]
  regionIds: readonly string[]
}

/** Live Medusa facts, read server-side; never from a storefront or request body. */
export type NativeSalesChannelFact = { id: string; is_disabled: boolean }
export type NativeRegionFact = { id: string; currency_code: string; countries: readonly string[] }

export interface NativeSellerFactsReader {
  read(
    salesChannelIds: readonly string[],
    regionIds: readonly string[],
  ): Promise<{ salesChannels: NativeSalesChannelFact[]; regions: NativeRegionFact[] }>
}

export type CanonicalNativeSellerConfiguration = {
  reference: string
  canonical: string
  digest: string
  currencyScope: string[]
}

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/
const TENANT = /^tn_[a-z0-9]{3,60}$/
const ENGINE = /^ei_[a-z0-9]{3,60}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MARKET = /^[A-Z]{2}$/
const CURRENCY = /^[A-Z]{3}$/

const deny = (reason: string): never => {
  throw new Error(`Native seller configuration denied: ${reason}`)
}

const distinct = (values: readonly string[], what: string): string[] => {
  if (!Array.isArray(values) || values.length === 0) deny(`${what} is empty`)
  const out = [...values]
  if (out.some((v) => typeof v !== "string" || !v.trim() || v !== v.trim()))
    deny(`${what} has a blank identifier`)
  if (new Set(out).size !== out.length) deny(`${what} has duplicates`)
  return out.sort()
}

const byId = <T extends { id: string }>(facts: readonly T[], ids: string[], what: string): T[] => {
  const found = new Map<string, T>()
  for (const fact of facts ?? []) {
    if (found.has(fact.id)) deny(`${what} ${fact.id} read more than once`)
    found.set(fact.id, fact)
  }
  if (found.size !== ids.length || ids.some((id) => !found.has(id)))
    deny(`${what} set does not match the declared configuration`)
  return ids.map((id) => found.get(id) as T)
}

/**
 * Builds the canonical document and its digest. Every declared channel and
 * region must exist exactly once, every channel must be enabled, every region
 * must serve only the binding's market, and the currency scope must equal the
 * set of region currencies: a binding can never authorise a currency or
 * country the native configuration does not actually serve, nor leave one
 * the configuration serves outside its scope.
 */
export function canonicalNativeSellerConfiguration(
  scope: NativeSellerConfigurationScope,
  salesChannels: readonly NativeSalesChannelFact[],
  regions: readonly NativeRegionFact[],
): CanonicalNativeSellerConfiguration {
  if (!scope) deny("no scope")
  if (
    typeof scope.reference !== "string" ||
    scope.reference.length > 128 ||
    !REFERENCE.test(scope.reference)
  )
    deny("invalid configuration reference")
  if (!TENANT.test(scope.tenantId ?? "")) deny("invalid tenant")
  if (!UUID.test(scope.organisationId ?? "")) deny("invalid operating Organisation")
  if (!MARKET.test(scope.market ?? "")) deny("invalid market")
  if (!ENGINE.test(scope.engineInstanceId ?? "")) deny("invalid engine instance")
  const currencyScope = distinct(scope.currencyScope, "currency scope")
  if (currencyScope.some((c) => !CURRENCY.test(c))) deny("invalid currency")
  const channelIds = distinct(scope.salesChannelIds, "sales channel set")
  const regionIds = distinct(scope.regionIds, "region set")

  const channels = byId(salesChannels, channelIds, "sales channel").map((channel) => {
    if (channel.is_disabled !== false) deny(`sales channel ${channel.id} is disabled`)
    return { id: channel.id, is_disabled: false }
  })
  const served = new Set<string>()
  const regionFacts = byId(regions, regionIds, "region").map((region) => {
    const currency = String(region.currency_code ?? "").toUpperCase()
    if (!currencyScope.includes(currency)) deny(`region ${region.id} currency is outside the scope`)
    served.add(currency)
    const countries = [
      ...new Set((region.countries ?? []).map((c) => String(c).toUpperCase())),
    ].sort()
    if (countries.length === 0 || countries.some((c) => c !== scope.market))
      deny(`region ${region.id} serves a country outside the market`)
    return { id: region.id, currency_code: currency, countries }
  })
  if (currencyScope.some((c) => !served.has(c))) deny("a scoped currency is served by no region")

  // Key order is fixed here, arrays are sorted, and no value is a float, so
  // the serialisation is deterministic across runtimes.
  const canonical = JSON.stringify({
    canonicalization: NATIVE_CONFIGURATION_CANONICALIZATION,
    tenant_id: scope.tenantId,
    operating_organisation_id: scope.organisationId,
    market: scope.market,
    engine_instance_id: scope.engineInstanceId,
    native_configuration_reference: scope.reference,
    currency_scope: currencyScope,
    sales_channels: channels,
    regions: regionFacts,
  })
  return {
    reference: scope.reference,
    canonical,
    digest: createHash("sha256").update(canonical, "utf8").digest("hex"),
    currencyScope,
  }
}

/** Reads the live native facts and returns the current canonical digest. */
export async function currentNativeSellerConfiguration(
  scope: NativeSellerConfigurationScope,
  reader: NativeSellerFactsReader,
): Promise<CanonicalNativeSellerConfiguration> {
  if (!reader) deny("native configuration reader unavailable")
  const facts = await reader.read(scope.salesChannelIds, scope.regionIds)
  return canonicalNativeSellerConfiguration(scope, facts.salesChannels, facts.regions)
}
