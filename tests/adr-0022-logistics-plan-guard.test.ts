import { describe, expect, it } from "vitest"
import {
  adoptLogisticsBooking,
  validateShipmentPlan,
  type ShipmentLogisticsPlan,
  type BookingIntent,
  type ProviderBookingEvidence,
} from "../src/baobab/fulfilment/logistics-plan-guard"

const plan: ShipmentLogisticsPlan = {
  tenantId: "zb-tenant",
  shipmentId: "shipment-1",
  sellerLegalEntityId: "zb-ug",
  originLocationId: "warehouse-kampala",
  destinationLocationId: "customer-jhb",
  planRevision: "r2",
  createdAt: "2026-11-09T08:00:00Z",
  legs: [
    {
      legId: "leg-road-1", fromLocationId: "warehouse-kampala", toLocationId: "airport-entebbe",
      transportMode: "ROAD", providerRole: "CARRIER", providerBindingId: "cp-road-provider",
      plannedDeparture: "2026-11-10T08:00:00Z", plannedArrival: "2026-11-10T09:00:00Z",
    },
    {
      legId: "leg-air-2", fromLocationId: "airport-entebbe", toLocationId: "airport-jhb",
      transportMode: "AIR", providerRole: "FREIGHT_FORWARDER", providerBindingId: "cp-air-provider",
      plannedDeparture: "2026-11-10T12:00:00Z", plannedArrival: "2026-11-11T12:00:00Z",
    },
    {
      legId: "leg-road-3", fromLocationId: "airport-jhb", toLocationId: "customer-jhb",
      transportMode: "ROAD", providerRole: "THIRD_PARTY_LOGISTICS", providerBindingId: "cp-lastmile",
      plannedDeparture: "2026-11-11T14:00:00Z", plannedArrival: "2026-11-11T16:00:00Z",
    },
  ],
}
const intent: BookingIntent = {
  tenantId: plan.tenantId, shipmentId: plan.shipmentId, legId: "leg-air-2",
  providerBindingId: "cp-air-provider", idempotencyKey: "idem-air-2",
  quoteReference: "quoted-air-2", planRevision: plan.planRevision,
}
const confirmed: ProviderBookingEvidence = {
  ...intent, status: "CONFIRMED", providerReference: "air-operator-1",
  bookingReference: "native-booking-20", evidenceReference: "native-receipt-20",
  observedAt: "2026-11-10T09:30:00Z",
}

describe("ADR-0022 provider-neutral logistics plan", () => {
  it("supports three connected provider roles across two transport modes", () => {
    expect(validateShipmentPlan(plan).legs).toHaveLength(3)
    expect(validateShipmentPlan(plan)).toEqual(plan)
  })
  it("refuses any missing leg, gap, loop, duplicated leg or negative travel interval", () => {
    expect(() => validateShipmentPlan({ ...plan, legs: [] })).toThrow("ordered")
    expect(() => validateShipmentPlan({ ...plan, originLocationId: "other" })).toThrow("full shipment")
    expect(() => validateShipmentPlan({
      ...plan, legs: [plan.legs[0], { ...plan.legs[1], fromLocationId: "unknown" }, plan.legs[2]],
    })).toThrow("disconnected")
    expect(() => validateShipmentPlan({
      ...plan, legs: [plan.legs[0], { ...plan.legs[1], legId: plan.legs[0].legId }, plan.legs[2]],
    })).toThrow("duplicate")
    expect(() => validateShipmentPlan({
      ...plan, legs: [plan.legs[0], { ...plan.legs[1], plannedArrival: "2026-11-09T10:00:00Z" }, plan.legs[2]],
    })).toThrow("arrival")
  })
  it("adopts exact current native confirmed booking evidence and permits safe replay", () => {
    expect(adoptLogisticsBooking(plan, intent, confirmed)).toEqual(confirmed)
    expect(adoptLogisticsBooking(plan, intent, confirmed, confirmed)).toEqual(confirmed)
  })
  it("cannot adopt unknown, rejected or pending provider outcomes as a booking", () => {
    for (const status of ["UNKNOWN", "PENDING", "REJECTED"] as const) {
      expect(() => adoptLogisticsBooking(plan, intent, { ...confirmed, status })).toThrow(
        "no native confirmed",
      )
    }
  })
  it("rejects wrong tenant, shipment, leg, provider binding or plan revision", () => {
    for (const field of ["tenantId", "shipmentId", "legId", "providerBindingId", "planRevision"] as const) {
      expect(() => adoptLogisticsBooking(plan, { ...intent, [field]: "foreign" }, confirmed)).toThrow(
        "does not match",
      )
    }
  })
  it("rejects altered idempotency and price-quote identity even for the same leg", () => {
    for (const field of ["idempotencyKey", "quoteReference"] as const) {
      expect(() => adoptLogisticsBooking(plan, intent, { ...confirmed, [field]: "other" })).toThrow(
        "foreign booking evidence",
      )
    }
  })
  it("refuses empty evidence references and stale pre-plan booking claims", () => {
    expect(() => adoptLogisticsBooking(plan, intent, { ...confirmed, bookingReference: "" })).toThrow(
      "invalid",
    )
    expect(() =>
      adoptLogisticsBooking(plan, intent, { ...confirmed, observedAt: "2026-11-09T07:00:00Z" }),
    ).toThrow("predates plan")
  })
  it("never adopts a conflicting native booking under an existing idempotency key", () => {
    expect(() =>
      adoptLogisticsBooking(plan, intent, confirmed, {
        ...confirmed, bookingReference: "different-native-booking",
      }),
    ).toThrow("changed native booking")
  })
})
