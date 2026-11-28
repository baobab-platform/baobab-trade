import { createHash } from "node:crypto"
import type { TradeIncoterm } from "./trade-metadata"

/**
 * ADR-0026: structured agreed delivery terms and independent risk milestone
 * validation. No title, customs, VAT, payment or accounting decision is made.
 */
export type IncotermAgreement = {
  tenantId: string
  transactionReference: string
  shipmentReference: string
  code: TradeIncoterm
  rulesVersion: "2020"
  namedPlace: {
    canonicalLocationId: string
    name: string
    country: string
  }
  transportMode: "ROAD" | "AIR" | "SEA" | "INLAND_WATERWAY" | "RAIL" | "MULTIMODAL"
  deliveryRuleProviderReference: string
  deliveryRuleVersion: string
  titlePolicyReference: string
  paymentTermsReference: string
  taxContextReference: string
}
export type RiskMilestoneEvidence = {
  tenantId: string
  transactionReference: string
  shipmentReference: string
  milestoneType: string
  eventReference: string
  evidenceReference: string
  observedAt: string
  actual: boolean
  providerReference: string
  rulesVersion: string
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const CODES: readonly string[] = [
  "EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF",
]
const WATER = new Set(["FAS", "FOB", "CFR", "CIF"])
const modes = ["ROAD", "AIR", "SEA", "INLAND_WATERWAY", "RAIL", "MULTIMODAL"]
export class IncotermContractRefusal extends Error {
  constructor(readonly reason: string) {
    super("ADR-0026 incoterm refusal: " + reason)
  }
}
const deny = (reason: string): never => {
  throw new IncotermContractRefusal(reason)
}
const id = (v: unknown, name: string) => {
  if (typeof v !== "string" || !ID.test(v)) deny("invalid " + name)
}
const instant = (value: string) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    return deny("missing actual UTC observation")
  const n = Date.parse(value)
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 19) !== value.slice(0, 19))
    return deny("invalid actual UTC observation")
  return n
}

/** Preserves the agreed version and named place; maritime-only terms require water mode. */
export function snapshotDeliveryAgreement(agreement: IncotermAgreement): {
  snapshot: IncotermAgreement; fingerprint: string
} {
  for (const field of [
    "tenantId", "transactionReference", "shipmentReference", "deliveryRuleProviderReference",
    "deliveryRuleVersion", "titlePolicyReference", "paymentTermsReference", "taxContextReference",
  ] as const) id(agreement[field], field)
  if (!CODES.includes(agreement.code) || agreement.rulesVersion !== "2020")
    deny("unrecognised rules code/version")
  if (!modes.includes(agreement.transportMode)) deny("invalid transport mode")
  if (WATER.has(agreement.code) &&
      agreement.transportMode !== "SEA" && agreement.transportMode !== "INLAND_WATERWAY")
    deny("maritime-only Incoterm is incompatible with transport mode")
  const place = agreement.namedPlace
  if (!place || typeof place.name !== "string" || !place.name.trim() || place.name.length > 200)
    deny("contractual named place is missing")
  id(place.canonicalLocationId, "canonical location")
  if (!/^[A-Z]{2}$/.test(place.country)) deny("named place country is invalid")
  const snapshot = structuredClone(agreement)
  return {
    snapshot,
    fingerprint: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
  }
}

/**
 * A plan/schedule is not risk transfer. A trusted carrier/TMS event and
 * separately qualified delivery rule must identify the exact milestone.
 * Actual risk projection is separate from title and never mutates it.
 */
export function assertActualRiskMilestone(
  agreement: IncotermAgreement,
  expectedMilestoneType: string,
  event: RiskMilestoneEvidence,
  currentTime: string,
): { riskMilestoneReference: string; titleChanged: false } {
  snapshotDeliveryAgreement(agreement)
  id(expectedMilestoneType, "expected milestone")
  const now = instant(currentTime)
  if (event.tenantId !== agreement.tenantId ||
      event.transactionReference !== agreement.transactionReference ||
      event.shipmentReference !== agreement.shipmentReference ||
      event.rulesVersion !== agreement.deliveryRuleVersion ||
      event.milestoneType !== expectedMilestoneType)
    deny("foreign or mismatched risk event")
  for (const field of ["eventReference", "evidenceReference", "providerReference"] as const)
    id(event[field], field)
  const observed = instant(event.observedAt)
  if (event.actual !== true || observed > now)
    deny("planned or future event cannot transfer risk")
  return { riskMilestoneReference: event.eventReference, titleChanged: false }
}
