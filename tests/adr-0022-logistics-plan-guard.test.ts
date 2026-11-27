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
  buyerLegalEntityId: "buyer-za",
  marketId: "market-za",
  marketRevision: 3,
  tradeLaneId: "lane-ug-za",
  originCountry: "UG",
  destinationCountry: "ZA",
  incoterm: "CIF",
  shipmentType: "CUSTOMER_DELIVERY",
  originLocationId: "warehouse-kampala",
  destinationLocationId: "customer-jhb",
  planRevision: 2,
  createdAt: "2026-11-09T08:00:00Z",
  legs: [
    {
      legId: "leg-road-1",
      sequence: 1,
      fromLocationId: "warehouse-kampala",
      toLocationId: "airport-entebbe",
      transportMode: "ROAD",
      providerRole: "CARRIER",
      providerId: "carrier-road",
      providerBindingId: "cp-road-provider",
      providerVersion: "carrier-v1",
      bindingVersion: "binding-v1",
      plannedDeparture: "2026-11-10T08:00:00Z",
      plannedArrival: "2026-11-10T09:00:00Z",
    },
    {
      legId: "leg-air-2",
      sequence: 2,
      fromLocationId: "airport-entebbe",
      toLocationId: "airport-jhb",
      transportMode: "AIR",
      providerRole: "FREIGHT_FORWARDER",
      providerId: "air-forwarder",
      providerBindingId: "cp-air-provider",
      providerVersion: "air-v2",
      bindingVersion: "binding-v2",
      plannedDeparture: "2026-11-10T12:00:00Z",
      plannedArrival: "2026-11-11T12:00:00Z",
    },
    {
      legId: "leg-road-3",
      sequence: 3,
      fromLocationId: "airport-jhb",
      toLocationId: "customer-jhb",
      transportMode: "ROAD",
      providerRole: "LAST_MILE_PROVIDER",
      providerId: "lastmile-3pl",
      providerBindingId: "cp-lastmile",
      providerVersion: "lastmile-v1",
      bindingVersion: "binding-v1",
      plannedDeparture: "2026-11-11T14:00:00Z",
      plannedArrival: "2026-11-11T16:00:00Z",
    },
  ],
}
const intent: BookingIntent = {
  tenantId: plan.tenantId,
  shipmentId: plan.shipmentId,
  sellerLegalEntityId: plan.sellerLegalEntityId,
  buyerLegalEntityId: plan.buyerLegalEntityId,
  marketId: plan.marketId,
  marketRevision: plan.marketRevision,
  tradeLaneId: plan.tradeLaneId,
  incoterm: plan.incoterm,
  shipmentType: plan.shipmentType,
  legId: "leg-air-2",
  transportMode: "AIR",
  providerRole: "FREIGHT_FORWARDER",
  providerId: "air-forwarder",
  providerBindingId: "cp-air-provider",
  providerVersion: "air-v2",
  bindingVersion: "binding-v2",
  idempotencyKey: "idem-air-2",
  quoteReference: "quoted-air-2",
  quoteVersion: "quote-v3",
  quoteCurrency: "ZAR",
  quoteAmountMinor: 250000,
  quoteValidUntil: "2026-11-10T10:30:00Z",
  planRevision: plan.planRevision,
}
const confirmed: ProviderBookingEvidence = {
  ...intent,
  status: "CONFIRMED",
  providerReference: "air-operator-account",
  bookingReference: "native-booking-20",
  evidenceReference: "native-receipt-20",
  observedAt: "2026-11-10T09:30:00Z",
}

describe("ADR-0022 provider-neutral logistics plan and booking evidence", () => {
  it("supports ordered multi-leg transport with explicit provider roles and bindings", () => {
    expect(validateShipmentPlan(plan).legs).toHaveLength(3)
    expect(validateShipmentPlan(plan)).toEqual(plan)
  })

  it("refuses missing legs, route gaps, duplicate legs, invalid sequence and bad timing", () => {
    expect(() => validateShipmentPlan({ ...plan, legs: [] })).toThrow("ordered")
    expect(() => validateShipmentPlan({ ...plan, originLocationId: "other" })).toThrow("full shipment")
    expect(() => validateShipmentPlan({
      ...plan,
      legs: [plan.legs[0], { ...plan.legs[1], fromLocationId: "unknown" }, plan.legs[2]],
    })).toThrow("disconnected")
    expect(() => validateShipmentPlan({
      ...plan,
      legs: [plan.legs[0], { ...plan.legs[1], legId: plan.legs[0].legId }, plan.legs[2]],
    })).toThrow("duplicate")
    expect(() => validateShipmentPlan({
      ...plan,
      legs: [plan.legs[0], { ...plan.legs[1], sequence: 3 }, plan.legs[2]],
    })).toThrow("sequence")
    expect(() => validateShipmentPlan({
      ...plan,
      legs: [plan.legs[0], { ...plan.legs[1], plannedDeparture: "2026-11-09T07:00:00Z" }, plan.legs[2]],
    })).toThrow("relative to plan")
  })

  it("requires explicit Market revision, valid shipment type and cross-border lane/Incoterm", () => {
    expect(() => validateShipmentPlan({ ...plan, marketRevision: 0 })).toThrow("Market")
    expect(() => validateShipmentPlan({ ...plan, shipmentType: "UNKNOWN" as never })).toThrow("shipment Market")
    expect(() => validateShipmentPlan({ ...plan, tradeLaneId: undefined })).toThrow("Trade Lane")
    expect(() => validateShipmentPlan({ ...plan, incoterm: undefined })).toThrow("Trade Lane")
  })

  it("allows a domestic plan without an unnecessary Trade Lane or Incoterm", () => {
    const domestic = {
      ...plan,
      originCountry: "ZA",
      destinationCountry: "ZA",
      tradeLaneId: undefined,
      incoterm: undefined,
    }
    expect(validateShipmentPlan(domestic)).toEqual(domestic)
  })

  it("adopts exact native confirmed provider booking evidence and permits exact replay", () => {
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

  it("rejects wrong tenant, buyer/seller, Market, lane, plan or provider binding", () => {
    for (const field of [
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
      "providerId",
      "providerBindingId",
      "providerVersion",
      "bindingVersion",
      "planRevision",
      "providerRole",
      "transportMode",
    ] as const) {
      const value = field === "marketRevision" || field === "planRevision" ? 99 : "foreign"
      expect(() =>
        adoptLogisticsBooking(plan, { ...intent, [field]: value }, confirmed),
      ).toThrow("does not match")
    }
  })

  it("rejects altered idempotency and quote identity even for the same leg", () => {
    for (const field of [
      "idempotencyKey",
      "quoteReference",
      "quoteVersion",
      "quoteCurrency",
      "quoteAmountMinor",
      "quoteValidUntil",
    ] as const) {
      const value = field === "quoteAmountMinor" ? 1 : "other"
      expect(() =>
        adoptLogisticsBooking(plan, intent, { ...confirmed, [field]: value }),
      ).toThrow("foreign booking evidence")
    }
  })

  it("rejects invalid quote currency, amount and validity", () => {
    expect(() =>
      adoptLogisticsBooking(plan, { ...intent, quoteCurrency: "zar" }, confirmed),
    ).toThrow("quote or authority")
    expect(() =>
      adoptLogisticsBooking(plan, { ...intent, quoteAmountMinor: Number.MAX_SAFE_INTEGER + 1 }, confirmed),
    ).toThrow("quote or authority")
    expect(() =>
      adoptLogisticsBooking(plan, { ...intent, quoteValidUntil: "2026-11-10T09:00:00Z" }, confirmed),
    ).toThrow("quote/plan window")
  })

  it("refuses empty native references and booking observations outside plan/quote/departure windows", () => {
    expect(() => adoptLogisticsBooking(plan, intent, { ...confirmed, bookingReference: "" })).toThrow(
      "invalid",
    )
    expect(() =>
      adoptLogisticsBooking(plan, intent, { ...confirmed, observedAt: "2026-11-09T07:00:00Z" }),
    ).toThrow("quote/plan window")
    expect(() =>
      adoptLogisticsBooking(plan, intent, { ...confirmed, observedAt: "2026-11-10T11:00:00Z" }),
    ).toThrow("quote/plan window")
    expect(() =>
      adoptLogisticsBooking(plan, intent, { ...confirmed, observedAt: "2026-11-10T13:00:00Z" }),
    ).toThrow("quote/plan window")
  })

  it("never adopts a conflicting native provider booking under an existing idempotency key", () => {
    for (const change of [
      { bookingReference: "different-native-booking" },
      { providerReference: "different-provider-account" },
      { evidenceReference: "different-evidence" },
      { observedAt: "2026-11-10T09:31:00Z" },
      { status: "REJECTED" as const },
    ]) {
      expect(() =>
        adoptLogisticsBooking(plan, intent, confirmed, { ...confirmed, ...change }),
      ).toThrow("changed native provider booking")
    }
  })
})
