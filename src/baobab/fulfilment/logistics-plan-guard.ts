/**
 * ADR-0022 provider-neutral internal logistics plan and booking evidence fence.
 * It does not book a carrier or assert the provider is currently CP-authorised.
 * CP must resolve a binding for the exact tenant/Market/Trade Lane/context;
 * a trusted adapter must authenticate provider evidence and native readback.
 */
export type TransportMode = "ROAD" | "AIR" | "SEA" | "RAIL"
export type LogisticsProviderRole =
  | "CARRIER"
  | "FREIGHT_FORWARDER"
  | "COURIER"
  | "CUSTOMS_BROKER"
  | "WAREHOUSE_OPERATOR"
  | "THIRD_PARTY_LOGISTICS"
  | "PORT_AGENT"
  | "LAST_MILE_PROVIDER"
export type Incoterm = "EXW" | "FCA" | "FOB" | "CFR" | "CIF" | "DAP" | "DPU" | "DDP"
export type ShipmentType =
  | "CUSTOMER_DELIVERY"
  | "SUPPLIER_INBOUND"
  | "INTER_BRANCH_TRANSFER"
  | "INTERCOMPANY_TRANSFER"
  | "RETURN"
  | "REPLACEMENT"
  | "SAMPLE"

export type LogisticsLeg = Readonly<{
  legId: string
  sequence: number
  fromLocationId: string
  toLocationId: string
  transportMode: TransportMode
  providerRole: LogisticsProviderRole
  providerId: string
  providerBindingId: string
  providerVersion: string
  bindingVersion: string
  plannedDeparture: string
  plannedArrival: string
}>

export type ShipmentLogisticsPlan = Readonly<{
  tenantId: string
  shipmentId: string
  sellerLegalEntityId: string
  buyerLegalEntityId: string
  marketId: string
  marketRevision: number
  tradeLaneId?: string
  originCountry: string
  destinationCountry: string
  incoterm?: Incoterm
  shipmentType: ShipmentType
  originLocationId: string
  destinationLocationId: string
  planRevision: number
  createdAt: string
  legs: readonly LogisticsLeg[]
}>

export type BookingIntent = Readonly<{
  tenantId: string
  shipmentId: string
  sellerLegalEntityId: string
  buyerLegalEntityId: string
  marketId: string
  marketRevision: number
  tradeLaneId?: string
  incoterm?: Incoterm
  shipmentType: ShipmentType
  legId: string
  transportMode: TransportMode
  providerRole: LogisticsProviderRole
  providerId: string
  providerBindingId: string
  providerVersion: string
  bindingVersion: string
  idempotencyKey: string
  quoteReference: string
  quoteVersion: string
  quoteCurrency: string
  quoteAmountMinor: number
  quoteValidUntil: string
  planRevision: number
}>

export type ProviderBookingEvidence = BookingIntent & Readonly<{
  status: "CONFIRMED" | "REJECTED" | "UNKNOWN" | "PENDING"
  providerReference: string
  bookingReference: string
  evidenceReference: string
  observedAt: string
}>

export class LogisticsRefusal extends Error {
  constructor(readonly reason: string) {
    super("ADR-0022 logistics refusal: " + reason)
  }
}
const deny = (reason: string): never => {
  throw new LogisticsRefusal(reason)
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const COUNTRY = /^[A-Z]{2}$/
const CURRENCY = /^[A-Z]{3}$/
const modes: readonly TransportMode[] = ["ROAD", "AIR", "SEA", "RAIL"]
const roles: readonly LogisticsProviderRole[] = [
  "CARRIER",
  "FREIGHT_FORWARDER",
  "COURIER",
  "CUSTOMS_BROKER",
  "WAREHOUSE_OPERATOR",
  "THIRD_PARTY_LOGISTICS",
  "PORT_AGENT",
  "LAST_MILE_PROVIDER",
]
const incoterms: readonly Incoterm[] = ["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DPU", "DDP"]
const present = (value: unknown, label: string): void => {
  if (typeof value !== "string" || !ID.test(value)) deny("invalid " + label)
}
const utc = (value: unknown, label: string): number => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) return deny("invalid UTC " + label)
  const date = Date.parse(value)
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 19) !== value.slice(0, 19))
    return deny("invalid UTC " + label)
  return date
}

const intentFields: readonly (keyof BookingIntent)[] = [
  "tenantId",
  "shipmentId",
  "sellerLegalEntityId",
  "buyerLegalEntityId",
  "marketId",
  "marketRevision",
  "tradeLaneId",
  "incoterm",
  "shipmentType",
  "legId",
  "transportMode",
  "providerRole",
  "providerId",
  "providerBindingId",
  "providerVersion",
  "bindingVersion",
  "idempotencyKey",
  "quoteReference",
  "quoteVersion",
  "quoteCurrency",
  "quoteAmountMinor",
  "quoteValidUntil",
  "planRevision",
]
const equalIntent = (a: BookingIntent, b: BookingIntent): boolean =>
  intentFields.every((key) => a[key] === b[key])

/** A logical shipment may have multiple provider legs, never one implicit carrier. */
export function validateShipmentPlan(plan: ShipmentLogisticsPlan): ShipmentLogisticsPlan {
  if (!plan || typeof plan !== "object") deny("shipment plan is required")
  for (const field of [
    "tenantId",
    "shipmentId",
    "sellerLegalEntityId",
    "buyerLegalEntityId",
    "marketId",
    "originLocationId",
    "destinationLocationId",
  ] as const) present(plan[field], field)
  if (
    !Number.isSafeInteger(plan.marketRevision) ||
    plan.marketRevision < 1 ||
    !Number.isSafeInteger(plan.planRevision) ||
    plan.planRevision < 1 ||
    !COUNTRY.test(plan.originCountry) ||
    !COUNTRY.test(plan.destinationCountry) ||
    !["CUSTOMER_DELIVERY", "SUPPLIER_INBOUND", "INTER_BRANCH_TRANSFER", "INTERCOMPANY_TRANSFER", "RETURN", "REPLACEMENT", "SAMPLE"].includes(plan.shipmentType) ||
    (plan.incoterm !== undefined && !incoterms.includes(plan.incoterm)) ||
    (plan.tradeLaneId !== undefined && !ID.test(plan.tradeLaneId))
  ) deny("shipment Market, revision, country, type or Incoterm context is invalid")
  const created = utc(plan.createdAt, "plan creation")
  if (!Array.isArray(plan.legs) || plan.legs.length < 1 || plan.legs.length > 32)
    deny("shipment requires a bounded ordered set of transport legs")
  const ids = new Set<string>()
  let previous: LogisticsLeg | undefined
  for (let index = 0; index < plan.legs.length; index += 1) {
    const leg = plan.legs[index]
    if (!leg || typeof leg !== "object") deny("invalid transport leg")
    for (const field of [
      "legId",
      "fromLocationId",
      "toLocationId",
      "providerId",
      "providerBindingId",
      "providerVersion",
      "bindingVersion",
    ] as const) present(leg[field], field)
    if (
      !Number.isSafeInteger(leg.sequence) ||
      leg.sequence !== index + 1 ||
      !modes.includes(leg.transportMode) ||
      !roles.includes(leg.providerRole)
    ) deny("invalid transport leg sequence, mode or provider role")
    if (ids.has(leg.legId)) deny("duplicate transport leg")
    ids.add(leg.legId)
    if (leg.fromLocationId === leg.toLocationId) deny("empty transport leg")
    const departure = utc(leg.plannedDeparture, "departure")
    const arrival = utc(leg.plannedArrival, "arrival")
    if (departure < created || departure >= arrival)
      deny("transport departure/arrival is invalid relative to plan creation")
    if (
      previous &&
      (previous.toLocationId !== leg.fromLocationId ||
        utc(previous.plannedArrival, "previous arrival") > departure)
    ) deny("disconnected or temporally inconsistent transport legs")
    previous = leg
  }
  if (
    plan.legs[0].fromLocationId !== plan.originLocationId ||
    plan.legs[plan.legs.length - 1].toLocationId !== plan.destinationLocationId
  ) deny("transport plan does not cover full shipment")
  if (
    plan.originCountry !== plan.destinationCountry &&
    (!plan.tradeLaneId || !ID.test(plan.tradeLaneId) || !plan.incoterm || !incoterms.includes(plan.incoterm))
  ) deny("cross-border shipment requires Trade Lane and Incoterm")
  return structuredClone(plan)
}

/**
 * Booking confirmation is only adopted after trusted provider readback.
 * Unknown, pending or rejected outcomes are not booked. Replays cannot adopt
 * a different provider, quote, plan revision or native booking.
 */
export function adoptLogisticsBooking(
  plan: ShipmentLogisticsPlan,
  intent: BookingIntent,
  evidence: ProviderBookingEvidence,
  prior?: ProviderBookingEvidence,
): ProviderBookingEvidence {
  const validatedPlan = validateShipmentPlan(plan)
  if (!intent || typeof intent !== "object") deny("booking intent is required")
  for (const field of [
    "tenantId",
    "shipmentId",
    "sellerLegalEntityId",
    "buyerLegalEntityId",
    "marketId",
    "legId",
    "providerId",
    "providerBindingId",
    "providerVersion",
    "bindingVersion",
    "idempotencyKey",
    "quoteReference",
    "quoteVersion",
  ] as const) present(intent[field], field)
  if (intent.tradeLaneId !== undefined) present(intent.tradeLaneId, "Trade Lane")
  if (
    !Number.isSafeInteger(intent.marketRevision) ||
    intent.marketRevision < 1 ||
    !Number.isSafeInteger(intent.planRevision) ||
    intent.planRevision < 1 ||
    (intent.incoterm !== undefined && !incoterms.includes(intent.incoterm)) ||
    !["CUSTOMER_DELIVERY", "SUPPLIER_INBOUND", "INTER_BRANCH_TRANSFER", "INTERCOMPANY_TRANSFER", "RETURN", "REPLACEMENT", "SAMPLE"].includes(intent.shipmentType) ||
    !modes.includes(intent.transportMode) ||
    !roles.includes(intent.providerRole) ||
    !CURRENCY.test(intent.quoteCurrency) ||
    !Number.isSafeInteger(intent.quoteAmountMinor) ||
    intent.quoteAmountMinor <= 0
  ) deny("booking quote or authority context is invalid")
  const quoteExpiry = utc(intent.quoteValidUntil, "quote expiry")
  const leg = validatedPlan.legs.find((item) => item.legId === intent.legId)
  if (
    !leg ||
    validatedPlan.tenantId !== intent.tenantId ||
    validatedPlan.shipmentId !== intent.shipmentId ||
    validatedPlan.sellerLegalEntityId !== intent.sellerLegalEntityId ||
    validatedPlan.buyerLegalEntityId !== intent.buyerLegalEntityId ||
    validatedPlan.marketId !== intent.marketId ||
    validatedPlan.marketRevision !== intent.marketRevision ||
    validatedPlan.tradeLaneId !== intent.tradeLaneId ||
    validatedPlan.incoterm !== intent.incoterm ||
    validatedPlan.shipmentType !== intent.shipmentType ||
    validatedPlan.planRevision !== intent.planRevision ||
    leg.transportMode !== intent.transportMode ||
    leg.providerRole !== intent.providerRole ||
    leg.providerId !== intent.providerId ||
    leg.providerBindingId !== intent.providerBindingId ||
    leg.providerVersion !== intent.providerVersion ||
    leg.bindingVersion !== intent.bindingVersion
  ) deny("booking intent does not match current shipment plan and CP provider binding")
  if (!evidence || typeof evidence !== "object" || !equalIntent(intent, evidence))
    deny("foreign booking evidence")
  if (evidence.status !== "CONFIRMED") deny("no native confirmed provider booking")
  for (const field of ["providerReference", "bookingReference", "evidenceReference"] as const)
    present(evidence[field], field)
  const observed = utc(evidence.observedAt, "booking observation")
  if (
    observed < utc(validatedPlan.createdAt, "plan creation") ||
    observed >= quoteExpiry ||
    observed >= utc(leg.plannedDeparture, "planned departure")
  ) deny("provider booking evidence is outside the valid quote/plan window")
  if (prior) {
    if (
      prior.status !== "CONFIRMED" ||
      !equalIntent(intent, prior) ||
      prior.providerReference !== evidence.providerReference ||
      prior.bookingReference !== evidence.bookingReference ||
      prior.evidenceReference !== evidence.evidenceReference ||
      prior.observedAt !== evidence.observedAt
    ) deny("replayed idempotency key changed native provider booking")
  }
  return structuredClone(evidence)
}
