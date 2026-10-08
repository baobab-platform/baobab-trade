import type { ExecArgs } from "@medusajs/framework/types"
import { ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID } from "../baobab/context/digital-estates"
import {
  ProjectedTradeComplianceAdapter,
  type CrossBorderTransactionMetadata,
} from "../baobab/trade-readiness"
import type TradeReadinessModuleService from "../modules/trade-readiness/service"
export default async function ({ container }: ExecArgs) {
  const service = container.resolve<TradeReadinessModuleService>("tradeReadiness")
  const lanes = await service.listTradeLanePolicies({
    digital_estate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
    status: "ACTIVE",
  })
  if (lanes.length !== 2) throw new Error(`Expected 2 trade lanes, found ${lanes.length}`)
  const transaction: CrossBorderTransactionMetadata = {
    digitalEstate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
    transactionReference: "gate11-ug-za",
    orderReference: "gate11-order",
    marketKey: "zuribeans_ug",
    legalSellerKey: "zuribeans-uganda",
    exporterOrganisationId: "zuribeans-uganda",
    importerOrganisationId: "gate11-importer",
    originCountry: "UG",
    destinationCountry: "ZA",
    incoterm: "CIF",
    customsProcedureReference: "gate11:customs-procedure",
    exportEligibilityReference: "policy:ug-coffee-export",
    exporterRegistrationReference: "gate11:exporter-registration",
    importerRegistrationReference: "gate11:importer-registration",
    customsDeclarationReference: "gate11:customs-declaration",
    exportPermitReference: "gate11:export-permit",
    lines: [
      {
        canonicalProductKey: "ug-arabica-green-aa",
        hsClassificationReference: "HS-0901.11",
        hsClassificationStatus: "VERIFIED",
        customsTariffReference: "gate11:customs-tariff",
        landedCostReference: "gate11:landed-cost",
        originCountry: "UG",
        originRegion: "Mount Elgon",
        tradeUom: "BAG",
        quantity: 20,
        netWeightKg: 1200,
        grossWeightKg: 1206,
        lotReference: "gate11-lot",
      },
    ],
    idempotencyKey: "gate11:transaction:ug-za",
    correlationId: "gate11-verification",
  }
  const port = new ProjectedTradeComplianceAdapter(
    {
      async listPolicies(originCountry, destinationCountry) {
        return (
          await service.listTradeLanePolicies({
            digital_estate: ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
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
      async isVerified({ canonicalProductKey, hsClassificationReference }) {
        return (
          canonicalProductKey === "ug-arabica-green-aa" &&
          hsClassificationReference === "HS-0901.11"
        )
      },
    },
  )
  const decision = await port.evaluate(transaction, new Date("2026-09-09T00:00:00Z"))
  if (decision.status !== "APPROVED") throw new Error("Complete trade transaction was not approved")
  let [storedDecision] = await service.listTradeComplianceDecisions({
    source_idempotency_key: "gate11:decision:ug-za",
  })
  if (!storedDecision)
    storedDecision = await service.createTradeComplianceDecisions({
      decision_reference: decision.decisionReference,
      transaction_reference: transaction.transactionReference,
      status: decision.status,
      policy_reference: decision.policyReference,
      policy_version: decision.policyVersion,
      reasons: decision.reasons,
      decided_at: decision.decidedAt,
      expires_at: decision.expiresAt,
      source: decision.source,
      source_idempotency_key: "gate11:decision:ug-za",
      correlation_id: transaction.correlationId,
    })
  const [existing] = await service.listCrossBorderTransactions({
    source_idempotency_key: transaction.idempotencyKey,
  })
  if (!existing)
    await service.createCrossBorderTransactions({
      transaction_reference: transaction.transactionReference,
      order_reference: transaction.orderReference,
      market_key: transaction.marketKey,
      legal_seller_key: transaction.legalSellerKey,
      exporter_organisation_id: transaction.exporterOrganisationId,
      importer_organisation_id: transaction.importerOrganisationId,
      origin_country: transaction.originCountry,
      destination_country: transaction.destinationCountry,
      incoterm: transaction.incoterm,
      customs_procedure_reference: transaction.customsProcedureReference,
      export_eligibility_reference: transaction.exportEligibilityReference,
      exporter_registration_reference: transaction.exporterRegistrationReference,
      importer_registration_reference: transaction.importerRegistrationReference,
      customs_declaration_reference: transaction.customsDeclarationReference,
      export_permit_reference: transaction.exportPermitReference,
      trade_lines: transaction.lines,
      compliance_decision_id: storedDecision.id,
      status: "READY",
      source_idempotency_key: transaction.idempotencyKey,
      correlation_id: transaction.correlationId,
    })
  container
    .resolve("logger")
    .info(
      "Verified Gate 11 classifications, origin, Incoterm, UOM, customs metadata, and compliance port",
    )
}
