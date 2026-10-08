/**
 * Gate 7 (Search): pure projection logic for the `thamani_product` search
 * index. Kept separate from the index definition (`src/search/`) so it is
 * testable without booting Medusa — the index definition's `consume`/`seed`
 * are thin wrappers around these functions.
 *
 * Search is a projection, never Product authority (spec §35): this module
 * only ever reads what bootstrap-thamani-catalogue.ts already wrote to the
 * product's native `metadata`, and never writes back to Product or the
 * `thamani` module's own tables.
 */
export const THAMANI_CATALOGUE_METADATA_TAG = "thamani_b2c"

export type ThamaniSearchableProductMetadata = {
  baobab_catalogue?: unknown
  thamani_category?: unknown
  thamani_brand?: unknown
  thamani_country_of_origin?: unknown
  thamani_supplier_key?: unknown
  thamani_consumer_uom?: unknown
  thamani_eligible_markets?: unknown
}

export type ThamaniProductVariant = {
  sku: string | null
  prices?: readonly { currency_code: string; amount: number }[]
}

export type ThamaniProductQueryResult = {
  id: string
  title: string
  handle: string
  description: string | null
  status: string
  metadata: ThamaniSearchableProductMetadata | null
  variants?: readonly ThamaniProductVariant[]
}

export type ThamaniProductSearchDocument = {
  id: string
  title: string
  handle: string
  description: string
  status: string
  thamani_category: string | null
  brand: string | null
  country_of_origin: string | null
  supplier_key: string | null
  consumer_uom: string | null
  eligible_market_keys: string[]
  sku: string | null
  price_ugx: number | null
  price_zar: number | null
}

/** The `query.graph` field selection the index's `consume`/`seed` need. */
export const THAMANI_SEARCH_PRODUCT_FIELDS = [
  "id",
  "title",
  "handle",
  "description",
  "status",
  "metadata",
  "variants.sku",
  "variants.prices.currency_code",
  "variants.prices.amount",
]

/**
 * This Trade engine instance also serves ZuriBeans B2B. The `thamani_product`
 * index must only ever hold Thamani products — a ZuriBeans product event
 * must be a no-op here, not accidentally indexed.
 */
export function isThamaniProduct(
  metadata: ThamaniSearchableProductMetadata | null | undefined,
): boolean {
  return metadata?.baobab_catalogue === THAMANI_CATALOGUE_METADATA_TAG
}

export type ThamaniMarketEligibilityRecordLike = {
  market_key: string
  status: "ACTIVE" | "SUSPENDED" | "WITHDRAWN"
}

/**
 * The `thamani_eligible_markets` metadata field — and so the search index's
 * Market isolation filter — must reflect the `thamani` module's own
 * `MarketProductEligibility` rows, the authority for eligibility, not the
 * static catalogue config a product was originally created from. A
 * `SUSPENDED`/`WITHDRAWN` row must narrow this list; only `ACTIVE` rows
 * count as eligible.
 */
export function deriveActiveEligibleMarketKeys(
  records: readonly ThamaniMarketEligibilityRecordLike[],
): string[] {
  return records.filter((record) => record.status === "ACTIVE").map((record) => record.market_key)
}

const asNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null

const asMarketKeyArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []

const priceInCurrency = (
  variant: ThamaniProductVariant | undefined,
  currencyCode: string,
): number | null => {
  const price = variant?.prices?.find((candidate) => candidate.currency_code === currencyCode)
  return price ? price.amount : null
}

/**
 * Builds the search document for one Thamani product. Callers must check
 * `isThamaniProduct` first — this function does not filter.
 */
export function toThamaniSearchDocument(
  product: ThamaniProductQueryResult,
): ThamaniProductSearchDocument {
  const metadata = product.metadata ?? {}
  const variant = product.variants?.[0]

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: product.description ?? "",
    status: product.status,
    thamani_category: asNullableString(metadata.thamani_category),
    brand: asNullableString(metadata.thamani_brand),
    country_of_origin: asNullableString(metadata.thamani_country_of_origin),
    supplier_key: asNullableString(metadata.thamani_supplier_key),
    consumer_uom: asNullableString(metadata.thamani_consumer_uom),
    eligible_market_keys: asMarketKeyArray(metadata.thamani_eligible_markets),
    sku: asNullableString(variant?.sku),
    price_ugx: priceInCurrency(variant, "ugx"),
    price_zar: priceInCurrency(variant, "zar"),
  }
}
