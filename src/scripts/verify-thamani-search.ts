import type { ExecArgs, ISearchModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { THAMANI_CATALOGUE, THAMANI_CATEGORY_COUNTS } from "../baobab/thamani/catalogue"
import { THAMANI_PRODUCT_SEARCH_INDEX } from "../baobab/thamani/search"

export default async function verifyThamaniSearch({ container }: ExecArgs): Promise<void> {
  const searchService = container.resolve<ISearchModuleService>(Modules.SEARCH)

  // Search health: the index must be migrated and fully seeded.
  const indexes = await searchService.listIndexes()
  const index = indexes.find((candidate) => candidate.name === THAMANI_PRODUCT_SEARCH_INDEX)
  if (!index) throw new Error(`${THAMANI_PRODUCT_SEARCH_INDEX} search index is not registered`)
  if (index.status !== "ready") {
    throw new Error(`${THAMANI_PRODUCT_SEARCH_INDEX} search index is not ready: ${index.status}`)
  }

  // Every Thamani product, and nothing else — a ZuriBeans product on this
  // same Trade engine instance must never leak into this index.
  const all = await searchService.search({
    entity: THAMANI_PRODUCT_SEARCH_INDEX,
    pagination: { take: THAMANI_CATALOGUE.length + 10 },
  })
  if (all.hits.length !== THAMANI_CATALOGUE.length) {
    throw new Error(
      `Expected ${THAMANI_CATALOGUE.length} indexed Thamani products, found ${all.hits.length}`,
    )
  }

  // Category facets match the governed catalogue composition (spec §15).
  const faceted = await searchService.search({
    entity: THAMANI_PRODUCT_SEARCH_INDEX,
    pagination: { take: 0 },
    search_options: { facets: ["thamani_category"] },
  })
  const categoryFacet = faceted.facets?.thamani_category
  if (!categoryFacet || categoryFacet.type !== "value") {
    throw new Error("thamani_category facet is missing from the search result")
  }
  for (const [category, expectedCount] of Object.entries(THAMANI_CATEGORY_COUNTS)) {
    const facetValue = categoryFacet.values.find((value) => value.value === category)
    if (facetValue?.count !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} indexed products in category ${category}, found ${facetValue?.count ?? 0}`,
      )
    }
  }

  // Market isolation (spec §36): a Uganda-only or South Africa-only SKU must
  // never surface as purchasable when searching the other Market. Today
  // neither surfaces for *either* Market: Gate 14's fail-closed compliance
  // gate (see `ensureRetailProjection` in bootstrap-thamani-catalogue.ts)
  // withholds every product's Market eligibility until its HS classification
  // is VERIFIED, and the launch catalogue's profiles are all deliberately
  // UNVERIFIED illustrative fixtures — so `eligible_market_keys` is empty for
  // every indexed product. `regression-thamani-trade-compliance-gate.ts`
  // proves eligibility (and so this isolation) genuinely activates once a
  // profile is verified.
  const ugResults = await searchService.search({
    entity: THAMANI_PRODUCT_SEARCH_INDEX,
    fields: ["id", "handle"],
    filters: { eligible_market_keys: { $overlaps: ["thamani_ug"] } },
    pagination: { take: THAMANI_CATALOGUE.length },
  })
  const zaResults = await searchService.search({
    entity: THAMANI_PRODUCT_SEARCH_INDEX,
    fields: ["id", "handle"],
    filters: { eligible_market_keys: { $overlaps: ["thamani_za"] } },
    pagination: { take: THAMANI_CATALOGUE.length },
  })

  if (ugResults.hits.length !== 0) {
    throw new Error(
      `Expected no Uganda Market-eligible products pending Gate 14 review, found ${ugResults.hits.length}`,
    )
  }
  if (zaResults.hits.length !== 0) {
    throw new Error(
      `Expected no South Africa Market-eligible products pending Gate 14 review, found ${zaResults.hits.length}`,
    )
  }

  // Free-text keyword search finds the expected products.
  const coffeeResults = await searchService.search({
    entity: THAMANI_PRODUCT_SEARCH_INDEX,
    filters: { q: "coffee" },
  })
  if (coffeeResults.hits.length === 0) {
    throw new Error('Free-text search for "coffee" returned no results')
  }

  container.resolve("logger").info("Verified Gate 7 Thamani B2C search health and Market isolation")
}

// This is a read-only health check, safe to run against any environment
// including production. The eligibility-suspension regression scenario that
// used to live here now lives in `regression-thamani-eligibility-sync.ts`,
// which mutates live data and must only run against a disposable database —
// see that file and `docs/architecture/thamani-search.md` for why.
