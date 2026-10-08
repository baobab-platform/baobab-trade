import { defineSearchIndex, search } from "@medusajs/framework/utils"
import type { Event, SearchIngestionContext, SearchSeedContext } from "@medusajs/framework/types"
import {
  isThamaniProduct,
  THAMANI_PRODUCT_SEARCH_INDEX,
  THAMANI_SEARCH_PRODUCT_FIELDS,
  toThamaniSearchDocument,
  type ThamaniProductQueryResult,
} from "../baobab/thamani/search"

/**
 * The `thamani_product` search index (Gate 7). Search is a projection, never
 * Product authority (spec §35): this index only ever reflects what
 * `bootstrap-thamani-catalogue.ts` already wrote to the product, and
 * `query.graph` still hydrates anything this index doesn't retrieve.
 *
 * This Trade engine instance also serves ZuriBeans B2B on the same Product
 * module, so `consume`/`seed` both filter to Thamani products explicitly
 * (`isThamaniProduct`) rather than assuming every `product.*` event or every
 * row in `seed` belongs to this estate.
 *
 * `eligible_market_keys` is the field Market isolation (spec §36) is built
 * on: a storefront query filters on it so a Uganda-only or South
 * Africa-only SKU never surfaces as purchasable in the other Market.
 *
 * Uses the native Postgres-backed `search-medusa`/`search-postgres` provider
 * registered in `medusa-config.ts` (no external service required). Swapping
 * to Meilisearch or another engine later is a provider change in
 * `medusa-config.ts`, not a change to this index definition.
 */
export default defineSearchIndex({
  name: THAMANI_PRODUCT_SEARCH_INDEX,
  entity: "product",
  primary_key: "id",
  fields: search.define({
    id: search.keyword().filterable(),
    title: search.text().searchable({ weight: 3 }),
    handle: search.keyword().filterable(),
    description: search.text().searchable({ weight: 1 }),
    status: search.keyword().filterable(),
    thamani_category: search.keyword().filterable().facetable(),
    brand: search.keyword().filterable().facetable(),
    country_of_origin: search.keyword().filterable().facetable(),
    supplier_key: search.keyword().filterable(),
    consumer_uom: search.keyword().filterable(),
    eligible_market_keys: search.keyword().filterable().array(),
    sku: search.keyword().filterable(),
    price_ugx: search.float().filterable().sortable(),
    price_zar: search.float().filterable().sortable(),
  }),
  events: ["product.created", "product.updated", "product.deleted"],
  async consume(event: Event<{ id: string }>, { container }: SearchIngestionContext) {
    const productId = event.data.id

    if (event.name === "product.deleted") {
      return [{ action: "delete", filters: { id: [productId] } }]
    }

    const { data } = await container.query.graph({
      entity: "product",
      filters: { id: productId },
      fields: THAMANI_SEARCH_PRODUCT_FIELDS,
    })
    const product = data[0] as ThamaniProductQueryResult | undefined

    if (!product || !isThamaniProduct(product.metadata)) {
      // Not a Thamani product (ZuriBeans, or since deleted): make sure it
      // isn't left behind in this index rather than assuming it never was.
      return [{ action: "delete", filters: { id: [productId] } }]
    }

    return [{ action: "upsert", documents: [toThamaniSearchDocument(product)] }]
  },
  async *seed({ container }: SearchSeedContext) {
    const pageSize = 200
    let skip = 0

    while (true) {
      const { data } = await container.query.graph({
        entity: "product",
        fields: THAMANI_SEARCH_PRODUCT_FIELDS,
        pagination: { skip, take: pageSize },
      })
      const products = data as ThamaniProductQueryResult[]
      if (products.length === 0) break

      const documents = products
        .filter((product) => isThamaniProduct(product.metadata))
        .map(toThamaniSearchDocument)
      if (documents.length > 0) yield documents

      if (products.length < pageSize) break
      skip += pageSize
    }
  },
})
