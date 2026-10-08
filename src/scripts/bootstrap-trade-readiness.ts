import type { ExecArgs } from "@medusajs/framework/types"
import { ZURIBEANS_TRADE_LANES } from "../baobab/trade-readiness"
import type TradeReadinessModuleService from "../modules/trade-readiness/service"
export default async function ({ container }: ExecArgs) {
  const service = container.resolve<TradeReadinessModuleService>("tradeReadiness")
  for (const lane of ZURIBEANS_TRADE_LANES) {
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
    const [existing] = await service.listTradeLanePolicies({
      digital_estate: lane.digitalEstate,
      policy_reference: lane.policyReference,
      policy_version: lane.policyVersion,
    })
    if (!existing)
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
  container.resolve("logger").info("Bootstrapped Gate 11 Uganda-South Africa trade lanes")
}
