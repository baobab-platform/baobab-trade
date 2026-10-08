import type { ExecArgs } from "@medusajs/framework/types"
import { THAMANI_DIGITAL_ESTATE_CANONICAL_ID } from "../baobab/context/digital-estates"
import {
  ProjectedTradeComplianceAdapter,
  type CrossBorderTransactionMetadata,
} from "../baobab/trade-readiness"
import { THAMANI_TRADE_LANES, THAMANI_TRADE_PROFILES } from "../baobab/thamani/trade-readiness"
import type TradeReadinessModuleService from "../modules/trade-readiness/service"

export default async function ({ container }: ExecArgs) {
  const service = container.resolve<TradeReadinessModuleService>("tradeReadiness")
  const lanes = await service.listTradeLanePolicies({
    digital_estate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
    status: "ACTIVE",
  })
  if (lanes.length !== THAMANI_TRADE_LANES.length)
    throw new Error(
      `Expected ${THAMANI_TRADE_LANES.length} Thamani trade lanes, found ${lanes.length}`,
    )
  const stored = await service.listThamaniTradeProfiles({})
  if (stored.length !== THAMANI_TRADE_PROFILES.length)
    throw new Error(
      `Expected ${THAMANI_TRADE_PROFILES.length} trade profiles, found ${stored.length}`,
    )
  if (stored.some((profile) => profile.hs_classification_status !== "UNVERIFIED"))
    throw new Error("Illustrative catalogue classifications must remain unverified")
  const profile = stored.find(
    (item) => item.market_key === "thamani_za" && item.origin_country === "UG",
  )
  if (!profile) throw new Error("Missing Uganda-origin South Africa import fixture")
  const transaction: CrossBorderTransactionMetadata = {
    digitalEstate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
    transactionReference: "thamani-gate14-ug-za",
    orderReference: "thamani-procurement-gate14",
    marketKey: "thamani_za",
    legalSellerKey: "thamani-south-africa",
    exporterOrganisationId: "supplier:thamani-gate14-ug",
    importerOrganisationId: "thamani-south-africa",
    originCountry: "UG",
    destinationCountry: "ZA",
    incoterm: "DAP",
    customsProcedureReference: "customs-procedure:ug-za:import",
    exportEligibilityReference: "export-eligibility:pending-review",
    exporterRegistrationReference: "exporter-registration:pending-review",
    importerRegistrationReference: "importer-registration:thamani-za",
    lines: [
      {
        canonicalProductKey: profile.canonical_product_key,
        hsClassificationReference: profile.hs_classification_reference,
        hsClassificationStatus: profile.hs_classification_status,
        customsTariffReference: profile.customs_tariff_reference,
        landedCostReference: profile.landed_cost_reference,
        originCountry: profile.origin_country,
        tradeUom: "EACH",
        quantity: 10,
        netWeightKg: 5,
        grossWeightKg: 5.5,
      },
    ],
    idempotencyKey: "thamani:gate14:ug-za",
    correlationId: "thamani-gate14-verification",
  }
  const port = new ProjectedTradeComplianceAdapter(
    {
      async listPolicies(originCountry, destinationCountry) {
        return (
          await service.listTradeLanePolicies({
            digital_estate: THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
            origin_country: originCountry,
            destination_country: destinationCountry,
          })
        ).map((lane) => ({
          digitalEstate: lane.digital_estate,
          policyReference: lane.policy_reference,
          policyVersion: lane.policy_version,
          originCountry: lane.origin_country,
          destinationCountry: lane.destination_country,
          permittedIncoterms: lane.permitted_incoterms as string[],
          permittedTradeUoms: lane.permitted_trade_uoms as string[],
          effectiveFrom: lane.effective_from,
          effectiveUntil: lane.effective_until,
          source: lane.source,
        }))
      },
    },
    {
      async isVerified({ canonicalProductKey, marketKey, hsClassificationReference, effectiveAt }) {
        const [reviewed] = await service.listThamaniTradeProfiles({
          canonical_product_key: canonicalProductKey,
          market_key: marketKey,
          hs_classification_reference: hsClassificationReference,
          hs_classification_status: "VERIFIED",
        })
        return Boolean(reviewed?.reviewed_at && reviewed.reviewed_at <= effectiveAt)
      },
    },
  )
  const decision = await port.evaluate(transaction, new Date("2026-09-09T12:00:00Z"))
  if (
    decision.status !== "REVIEW_REQUIRED" ||
    !decision.reasons.includes("HS_CLASSIFICATION_UNVERIFIED")
  )
    throw new Error("Unverified HS classification did not fail closed")
  container
    .resolve("logger")
    .info("Verified Thamani Gate 14 origin, customs, landed-cost, and fail-closed compliance")
}
