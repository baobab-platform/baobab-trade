/**
 * Regression fixture for a bug a review caught on Gate 7: the search
 * index's `thamani_eligible_markets` field must reflect the `thamani`
 * module's own `MarketProductEligibility` records — the authority for
 * eligibility — not just the static catalogue config a product was
 * originally created from (see `deriveActiveEligibleMarketKeys` in
 * `src/baobab/thamani/search/projection.ts`).
 *
 * A later Gate 14 fix wired a fail-closed compliance gate into the same
 * eligibility-creation path (see `ensureRetailProjection` in
 * bootstrap-thamani-catalogue.ts): no eligibility row is created at all
 * until a product/Market pair's `ThamaniTradeProfile` is VERIFIED. Every
 * profile the launch catalogue bootstraps with is deliberately UNVERIFIED
 * (see `verify-thamani-trade-readiness.ts`), so this fixture product starts
 * with NO `thamani_za` eligibility — this script now proves the gate's
 * positive path first (verifying its profile genuinely unlocks eligibility)
 * before exercising the original suspend/resync scenario on top of it.
 *
 * DANGER — THIS SCRIPT MUTATES LIVE DATA. It creates a disposable
 * `ThamaniTradeProfile`/`MarketProductEligibility` pair, flips the
 * eligibility to `SUSPENDED` and back to `ACTIVE`, and re-runs the real
 * bootstrap/catalogue and bootstrap/search scripts throughout, then deletes
 * everything it created. It is deliberately NOT part of `verify:thamani-search`
 * (a read-only health check safe to run against any environment) because:
 *
 *   - A crash or termination between a write and its `finally` cleanup
 *     leaves the fixture mutated in whatever database this ran against.
 *   - The unconditional cleanup writes would silently clobber a legitimately
 *     pre-existing record at the same id — this script only ever runs
 *     safely against a disposable database it also owns bootstrapping (CI's
 *     ephemeral Postgres, or a local scratch database), never against a
 *     persistent or production environment.
 *
 * This also demonstrates, not hides, a real limitation: propagation from a
 * `MarketProductEligibility` change to the search index is NOT automatic or
 * event-driven today — it only happens because this script explicitly
 * re-runs `bootstrap-thamani-catalogue.ts` (which refreshes
 * `product.metadata` from the live eligibility rows) and
 * `bootstrap-thamani-search.ts` (which reindexes from that metadata). A
 * production eligibility change made through any other path will not reach
 * search until an operator or scheduled job reruns those bootstraps. See
 * "Eligibility-to-search propagation is not automatic" in
 * `docs/architecture/thamani-search.md`.
 */
import type {
  ExecArgs,
  IProductModuleService,
  ISearchModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { THAMANI_CATALOGUE } from "../baobab/thamani/catalogue"
import { THAMANI_PRODUCT_SEARCH_INDEX } from "../baobab/thamani/search"
import { THAMANI_TRADE_PROFILES } from "../baobab/thamani/trade-readiness"
import type ThamaniModuleService from "../modules/thamani/service"
import type TradeReadinessModuleService from "../modules/trade-readiness/service"
import bootstrapThamaniCatalogue from "./bootstrap-thamani-catalogue"
import bootstrapThamaniSearch from "./bootstrap-thamani-search"

export default async function regressionThamaniEligibilitySync({
  container,
}: ExecArgs): Promise<void> {
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const thamani = container.resolve<ThamaniModuleService>("thamani")
  const tradeReadiness = container.resolve<TradeReadinessModuleService>("tradeReadiness")
  const searchService = container.resolve<ISearchModuleService>(Modules.SEARCH)

  const handle = "thamani-uganda-black-tea-250g" // eligible in both Markets; not one of the isolation fixtures verify-thamani-search.ts checks
  const marketKey = "thamani_za"
  const [product] = await productService.listProducts({ handle })
  if (!product) throw new Error(`Regression fixture product "${handle}" is missing`)
  const config = THAMANI_CATALOGUE.find((candidate) => candidate.handle === handle)
  if (!config) throw new Error(`Regression fixture "${handle}" is missing from THAMANI_CATALOGUE`)

  const [preExistingEligibility] = await thamani.listMarketProductEligibilities({
    product_id: product.id,
    market_key: marketKey,
  })
  if (preExistingEligibility) {
    throw new Error(
      `"${handle}" already has a ${marketKey} eligibility record — expected none pending Gate 14 review; ` +
        "refusing to run this destructive fixture against a database whose fixture state isn't as expected",
    )
  }
  const [preExistingProfile] = await tradeReadiness.listThamaniTradeProfiles({
    canonical_product_key: config.canonicalKey,
    market_key: marketKey,
  })
  if (preExistingProfile) {
    throw new Error(
      `"${handle}" already has a ${marketKey} trade profile — expected none; ` +
        "refusing to run this destructive fixture against a database whose fixture state isn't as expected",
    )
  }
  const fixtureProfile = THAMANI_TRADE_PROFILES.find(
    (candidate) =>
      candidate.canonicalProductKey === config.canonicalKey && candidate.marketKey === marketKey,
  )
  if (!fixtureProfile) throw new Error(`No trade profile fixture for "${handle}"/${marketKey}`)

  const rerunFromEligibility = async () => {
    await bootstrapThamaniCatalogue({ container } as ExecArgs)
    await bootstrapThamaniSearch({ container } as ExecArgs)
  }

  {
    // Gate 14 positive path: verifying the profile must be what unlocks
    // eligibility — not the bootstrap re-run by itself.
    const profile = await tradeReadiness.createThamaniTradeProfiles({
      canonical_product_key: fixtureProfile.canonicalProductKey,
      market_key: fixtureProfile.marketKey,
      origin_country: fixtureProfile.originCountry,
      hs_classification_reference: fixtureProfile.hsClassificationReference,
      hs_classification_status: "VERIFIED",
      customs_tariff_reference: fixtureProfile.customsTariffReference,
      landed_cost_reference: fixtureProfile.landedCostReference,
      source: fixtureProfile.source,
      reviewed_at: new Date(),
    })
    try {
      await rerunFromEligibility()
      const [eligibility] = await thamani.listMarketProductEligibilities({
        product_id: product.id,
        market_key: marketKey,
      })
      if (!eligibility || eligibility.status !== "ACTIVE") {
        throw new Error(
          `Verifying "${handle}"'s ${marketKey} trade profile did not create ACTIVE eligibility`,
        )
      }

      await thamani.updateMarketProductEligibilities({ id: eligibility.id, status: "SUSPENDED" })
      await rerunFromEligibility()

      const zaAfterSuspension = await searchService.search({
        entity: THAMANI_PRODUCT_SEARCH_INDEX,
        fields: ["id", "handle"],
        filters: { eligible_market_keys: { $overlaps: [marketKey] } },
        pagination: { take: THAMANI_CATALOGUE.length },
      })
      if (zaAfterSuspension.hits.some((hit) => hit.document.handle === handle)) {
        throw new Error(
          `"${handle}" still surfaces for ${marketKey} search after its eligibility was suspended`,
        )
      }

      await thamani.updateMarketProductEligibilities({ id: eligibility.id, status: "ACTIVE" })
      await rerunFromEligibility()
    } finally {
      const [eligibility] = await thamani.listMarketProductEligibilities({
        product_id: product.id,
        market_key: marketKey,
      })
      if (eligibility) await thamani.deleteMarketProductEligibilities(eligibility.id)
      await tradeReadiness.deleteThamaniTradeProfiles(profile.id)
      await rerunFromEligibility()
    }
  }

  container
    .resolve("logger")
    .info(
      "Verified Thamani B2C trade-profile verification unlocks eligibility, and eligibility changes reach search via manual bootstrap resync",
    )
}
