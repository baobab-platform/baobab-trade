import {
  buildEngineNativeMappingTag,
  readMarketKeyFromMetadata,
  type EngineNativeMappingTag,
} from "../contracts/canonical-mapping"

type HasMetadata = { metadata?: Record<string, unknown> | null }

export const findByMetadataKey = <T extends HasMetadata>(
  records: readonly T[],
  key: string,
  value: string,
): T | undefined => records.find((record) => record.metadata?.[key] === value)

export const salesChannelProjectionTag = (salesChannelKey: string) => ({
  baobab_sales_channel_key: salesChannelKey,
  baobab_mapping_type: "CHANNEL" as const,
  baobab_mapping_authority: "trade-engine-native-pending-control-plane-registration" as const,
})

/**
 * Finds a previously-provisioned Medusa record by the market-key breadcrumb
 * this bootstrap leaves in `metadata`. Used to make Market provisioning
 * idempotent (ADR-0010 §51-§52) without a published Control Plane mapping
 * write API to register against instead.
 */
export const findByMarketKey = <T extends HasMetadata>(
  records: readonly T[],
  marketKey: string,
): T | undefined =>
  records.find((record) => readMarketKeyFromMetadata(record.metadata) === marketKey)

type HasCountries = { countries?: readonly { iso_2?: string | null }[] | null }

/**
 * Medusa enforces at most one Region per country store-wide
 * (`RegionModuleService.validateCountries`): two Digital Estates running on
 * this one Trade engine instance cannot each have their own Region for the
 * same country. A Region is therefore looked up and reused by country code,
 * never by the `baobab_market_key` breadcrumb, which only identifies who
 * happened to provision it first.
 */
export const findByCountryCode = <T extends HasCountries>(
  records: readonly T[],
  countryCode: string,
): T | undefined => {
  const normalised = countryCode.toLowerCase()
  return records.find((record) => record.countries?.some((country) => country.iso_2 === normalised))
}

export const regionMappingTag = (marketKey: string): EngineNativeMappingTag =>
  buildEngineNativeMappingTag("COMMERCE", marketKey)

export const salesChannelMappingTag = (marketKey: string): EngineNativeMappingTag =>
  buildEngineNativeMappingTag("CHANNEL", marketKey)

export const stockLocationMappingTag = (marketKey: string): EngineNativeMappingTag =>
  buildEngineNativeMappingTag("WAREHOUSE", marketKey)
