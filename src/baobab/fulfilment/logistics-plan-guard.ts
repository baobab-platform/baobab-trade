/**
 * ADR-0022 provider-neutral internal logistics plan and booking evidence fence.
 * It does not book a carrier or assert the provider is currently CP-authorised.
 * A trusted logistics adapter must attest provider binding and native readback.
 */
export type LogisticsLeg = {
  legId: string
  fromLocationId: string
  toLocationId: string
  transportMode: "ROAD" | "AIR" | "SEA" | "RAIL"
  providerRole: "CARRIER" | "FREIGHT_FORWARDER" | "THIRD_PARTY_LOGISTICS"
  providerBindingId: string
  plannedDeparture: string
  plannedArrival: string
}
export type ShipmentLogisticsPlan = {
  tenantId: string
  shipmentId: string
  sellerLegalEntityId: string
  originLocationId: string
  destinationLocationId: string
  planRevision: string
  createdAt: string
  legs: readonly LogisticsLeg[]
}
export type BookingIntent = {
  tenantId: string
  shipmentId: string
  legId: string
  providerBindingId: string
  idempotencyKey: string
  quoteReference: string
  planRevision: string
}
export type ProviderBookingEvidence = BookingIntent & {
  status: "CONFIRMED" | "REJECTED" | "UNKNOWN" | "PENDING"
  providerReference: string
  bookingReference: string
  evidenceReference: string
  observedAt: string
}

export class LogisticsRefusal extends Error {
  constructor(readonly reason: string) {
    super("ADR-0022 logistics refusal: " + reason)
  }
}
const deny = (reason: string): never => {
  throw new LogisticsRefusal(reason)
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const present = (value: unknown, label: string) => {
  if (typeof value !== "string" || !ID.test(value)) deny("invalid " + label)
}
const utc = (value: string, label: string): number => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    return deny("invalid UTC " + label)
  const date = Date.parse(value)
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 19) !== value.slice(0, 19))
    return deny("invalid UTC " + label)
  return date
}
const mode = ["ROAD", "AIR", "SEA", "RAIL"]
const roles = ["CARRIER", "FREIGHT_FORWARDER", "THIRD_PARTY_LOGISTICS"]
const equalIntent = (a: BookingIntent, b: BookingIntent): boolean =>
  (["tenantId", "shipmentId", "legId", "providerBindingId", "idempotencyKey", "quoteReference", "planRevision"] as const)
    .every((key) => a[key] === b[key])

/** A logical shipment may have multiple provider legs, never one implicit carrier. */
export function validateShipmentPlan(plan: ShipmentLogisticsPlan): ShipmentLogisticsPlan {
  for (const field of ["tenantId", "shipmentId", "sellerLegalEntityId", "originLocationId", "destinationLocationId", "planRevision"] as const)
    present(plan[field], field)
  utc(plan.createdAt, "plan creation")
  if (!Array.isArray(plan.legs) || plan.legs.length < 1 || plan.legs.length > 32)
    deny("shipment requires a bounded ordered set of transport legs")
  const ids = new Set<string>()
  let previous: LogisticsLeg | undefined
  for (const leg of plan.legs) {
    for (const field of ["legId", "fromLocationId", "toLocationId", "providerBindingId"] as const)
      present(leg[field], field)
    if (!mode.includes(leg.transportMode) || !roles.includes(leg.providerRole))
      deny("unsupported transport/provider role")
    if (ids.has(leg.legId)) deny("duplicate transport leg")
    ids.add(leg.legId)
    if (leg.fromLocationId === leg.toLocationId) deny("empty transport leg")
    const departure = utc(leg.plannedDeparture, "departure")
    const arrival = utc(leg.plannedArrival, "arrival")
    if (departure >= arrival) deny("transport arrival must follow departure")
    if (previous && (previous.toLocationId !== leg.fromLocationId ||
        utc(previous.plannedArrival, "previous arrival") > departure))
      deny("disconnected or temporally inconsistent transport legs")
    previous = leg
  }
  if (plan.legs[0].fromLocationId !== plan.originLocationId ||
      plan.legs[plan.legs.length - 1].toLocationId !== plan.destinationLocationId)
    deny("transport plan does not cover full shipment")
  return structuredClone(plan)
}

/**
 * Booking confirmation is only adopted after *trusted* provider readback.
 * A timeout, unknown state or rejection is not booked. Evidence ID and
 * original idempotency identity are mandatory. Replays cannot adopt a
 * different native booking.
 */
export function adoptLogisticsBooking(
  plan: ShipmentLogisticsPlan,
  intent: BookingIntent,
  evidence: ProviderBookingEvidence,
  prior?: ProviderBookingEvidence,
): ProviderBookingEvidence {
  validateShipmentPlan(plan)
  for (const field of ["idempotencyKey", "quoteReference"] as const) present(intent[field], field)
  const leg = plan.legs.find((x) => x.legId === intent.legId)
  if (!leg || plan.tenantId !== intent.tenantId || plan.shipmentId !== intent.shipmentId ||
      plan.planRevision !== intent.planRevision || leg.providerBindingId !== intent.providerBindingId)
    deny("booking intent does not match authoritative shipment plan")
  if (!equalIntent(intent, evidence)) deny("foreign booking evidence")
  if (evidence.status !== "CONFIRMED") deny("no native confirmed provider booking")
  for (const field of ["providerReference", "bookingReference", "evidenceReference"] as const)
    present(evidence[field], field)
  const observed = utc(evidence.observedAt, "booking observation")
  if (observed < utc(plan.createdAt, "plan creation")) deny("provider evidence predates plan")
  if (prior && (!equalIntent(intent, prior) || prior.bookingReference !== evidence.bookingReference ||
      prior.evidenceReference !== evidence.evidenceReference))
    deny("replayed idempotency key changed native booking")
  return structuredClone(evidence)
}
