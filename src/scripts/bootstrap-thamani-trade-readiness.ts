import type { ExecArgs } from "@medusajs/framework/types"
import { THAMANI_TRADE_LANES, THAMANI_TRADE_PROFILES } from "../baobab/thamani/trade-readiness"
import type TradeReadinessModuleService from "../modules/trade-readiness/service"

export default async function ({ container }: ExecArgs) {
  const service = container.resolve<TradeReadinessModuleService>("tradeReadiness")
  for (const lane of THAMANI_TRADE_LANES) {
    const active = await service.listTradeLanePolicies({
      digital_estate: lane.digitalEstate,
      origin_country: lane.originCountry,
      destination_country: lane.destinationCountry,
      status: "ACTIVE",
    })
    for (const superseded of active.filter(
      (candidate) =>
        candidate.policy_reference !== lane.policyReference ||
        candidate.policy_version !== lane.policyVersion,
    ))
      await service.updateTradeLanePolicies({
        id: superseded.id,
        effective_until: lane.effectiveFrom,
        status: "SUPERSEDED",
      })
    const [existingLane] = await service.listTradeLanePolicies({
      digital_estate: lane.digitalEstate,
      policy_reference: lane.policyReference,
      policy_version: lane.policyVersion,
    })
    if (!existingLane)
      await service.createTradeLanePolicies({
        digital_estate: lane.digitalEstate,
        policy_reference: lane.policyReference,
        policy_version: lane.policyVersion,
        origin_country: lane.originCountry,
        destination_country: lane.destinationCountry,
        permitted_incoterms: lane.permittedIncoterms,
        permitted_trade_uoms: lane.permittedTradeUoms,
        effective_from: lane.effectiveFrom,
        effective_until: lane.effectiveUntil,
        source: lane.source,
        status: "ACTIVE",
      })
  }
  for (const profile of THAMANI_TRADE_PROFILES) {
    const [existing] = await service.listThamaniTradeProfiles({
      canonical_product_key: profile.canonicalProductKey,
      market_key: profile.marketKey,
    })
    if (!existing)
      await service.createThamaniTradeProfiles({
        canonical_product_key: profile.canonicalProductKey,
        market_key: profile.marketKey,
        origin_country: profile.originCountry,
        hs_classification_reference: profile.hsClassificationReference,
        hs_classification_status: profile.hsClassificationStatus,
        customs_tariff_reference: profile.customsTariffReference,
        landed_cost_reference: profile.landedCostReference,
        source: profile.source,
      })
  }
  container
    .resolve("logger")
    .info(
      "Bootstrapped Thamani Gate 14 fail-closed product trade profiles and estate-scoped trade lanes",
    )
}
