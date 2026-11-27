import { describe, expect, it } from "vitest"
import {
  MedusaFulfilmentAdapter,
  type FulfilmentEvidence,
  type FulfilmentRecordRepository,
  type FulfilmentSnapshot,
  type RequestFulfilmentCommand,
} from "../src/baobab/fulfilment"

const command: RequestFulfilmentCommand = {
  fulfilmentReference: "ful-1",
  orderReference: "ord-1",
  tenantId: "tn_ugoperator",
  principalId: "principal_ug_1",
  organisationId: "org-1",
  marketId: "mkt_01k9ug7b2b",
  marketRevision: 1,
  marketKey: "zuribeans_ug",
  legalSellerKey: "seller-ug",
  sourceLocationKey: "UG-EBB-01",
  mode: "CROSS_BORDER",
  providerKey: "erp",
  shipment: {
    originCountry: "UG",
    destinationCountry: "ZA",
    exporterOrganisationId: "seller-ug",
    importerOrganisationId: "org-1",
    hsReferences: ["0901.11"],
    complianceDecisionId: "decision-1",
    incoterm: "CIF",
    grossWeightKg: 100,
    packageCount: 2,
  },
  idempotencyKey: "request-1",
  correlationId: "corr-1",
}

class MemoryRecords implements FulfilmentRecordRepository {
  record?: FulfilmentSnapshot

  async findByIdempotencyKey(key: string) {
    return this.record?.idempotencyKey === key ? this.record : undefined
  }

  async create(input: RequestFulfilmentCommand & { digitalEstate: string }) {
    return (this.record = { ...input, id: "ful_1", status: "REQUESTED" })
  }

  async transition(
    current: FulfilmentSnapshot,
    to: FulfilmentSnapshot["status"],
    _key: string,
    evidence: FulfilmentEvidence = {},
  ) {
    return (this.record = {
      ...current,
      shipmentReference: evidence.shipmentReference ?? current.shipmentReference,
      carrierReference: evidence.carrierReference ?? current.carrierReference,
      trackingReference: evidence.trackingReference ?? current.trackingReference,
      trackingUrl: evidence.trackingUrl ?? current.trackingUrl,
      dispatchDate: evidence.dispatchDate ?? current.dispatchDate,
      deliveryDate: evidence.deliveryDate ?? current.deliveryDate,
      status: to,
    })
  }
}

describe("FulfilmentPort", () => {
  it("requests idempotently and requires source-backed dispatch evidence", async () => {
    const port = new MedusaFulfilmentAdapter(new MemoryRecords())
    const first = await port.request(command)
    expect((await port.request(command)).id).toBe(first.id)
    const accepted = await port.transition(first, "ACCEPTED", "accept-1")
    const allocated = await port.transition(accepted, "ALLOCATED", "allocate-1")
    await expect(port.transition(allocated, "DISPATCHED", "dispatch-1")).rejects.toThrow(
      /external execution evidence/,
    )
  })

  it("requires provider event evidence for dispatch and delivery and preserves physical references", async () => {
    const port = new MedusaFulfilmentAdapter(new MemoryRecords())
    const requested = await port.request(command)
    const accepted = await port.transition(requested, "ACCEPTED", "accept-1")
    const allocated = await port.transition(accepted, "ALLOCATED", "allocate-1")
    const dispatched = await port.transition(allocated, "DISPATCHED", "dispatch-1", {
      sourceSystem: "CARRIER",
      sourceEventReference: "carrier-event-1",
      shipmentReference: "shipment-1",
      carrierReference: "carrier-consignment-1",
      dispatchDate: new Date("2026-11-27T08:00:00.000Z"),
    })
    expect(dispatched).toMatchObject({ status: "DISPATCHED", shipmentReference: "shipment-1" })
    const delivered = await port.transition(dispatched, "DELIVERED", "delivery-1", {
      sourceSystem: "CARRIER",
      sourceEventReference: "carrier-event-2",
      shipmentReference: "shipment-1",
      deliveryDate: new Date("2026-11-28T08:00:00.000Z"),
    })
    expect(delivered.status).toBe("DELIVERED")
  })

  it("rejects delivery evidence that predates dispatch", async () => {
    const port = new MedusaFulfilmentAdapter(new MemoryRecords())
    const requested = await port.request(command)
    const accepted = await port.transition(requested, "ACCEPTED", "accept-1")
    const allocated = await port.transition(accepted, "ALLOCATED", "allocate-1")
    const dispatched = await port.transition(allocated, "DISPATCHED", "dispatch-1", {
      sourceSystem: "WMS",
      sourceEventReference: "wms-event-1",
      shipmentReference: "shipment-1",
      dispatchDate: new Date("2026-11-27T08:00:00.000Z"),
    })
    await expect(
      port.transition(dispatched, "DELIVERED", "delivery-1", {
        sourceSystem: "CARRIER",
        sourceEventReference: "carrier-event-2",
        deliveryDate: new Date("2026-11-26T08:00:00.000Z"),
      }),
    ).rejects.toThrow("cannot predate dispatch")
  })

  it("rejects non-HTTPS tracking URLs and unknown evidence sources", async () => {
    const port = new MedusaFulfilmentAdapter(new MemoryRecords())
    const requested = await port.request(command)
    await expect(
      port.transition(requested, "ACCEPTED", "accept-1", {
        trackingUrl: "http://carrier.example/track/1",
      }),
    ).rejects.toThrow("HTTPS")
    await expect(
      port.transition(requested, "ACCEPTED", "accept-2", {
        sourceSystem: "BROWSER" as never,
      }),
    ).rejects.toThrow("source is invalid")
  })

  it("rejects a B2C request that reuses a B2B idempotency key instead of returning the other estate's fulfilment", async () => {
    const port = new MedusaFulfilmentAdapter(new MemoryRecords())
    await port.request(command)
    await expect(
      port.request({
        ...command,
        organisationId: undefined,
        customerReference: "customer-1",
      }),
    ).rejects.toThrow(/different shipment/)
  })

  it("rejects incomplete cross-border trade metadata", async () => {
    const port = new MedusaFulfilmentAdapter(new MemoryRecords())
    await expect(
      port.request({ ...command, shipment: { ...command.shipment, hsReferences: [] } }),
    ).rejects.toThrow(/incomplete/)
  })

  it("derives the existing B2B and B2C Digital Estate mapping from the one-party identity", async () => {
    const zuriPort = new MedusaFulfilmentAdapter(new MemoryRecords())
    const zuri = await zuriPort.request(command)
    expect(zuri.digitalEstate).toBe("estate:zuribeans-b2b")
    const thamaniPort = new MedusaFulfilmentAdapter(new MemoryRecords())
    const thamani = await thamaniPort.request({
      ...command,
      organisationId: undefined,
      customerReference: "customer-1",
      idempotencyKey: "request-2",
    })
    expect(thamani.digitalEstate).toBe("estate:thamani-b2c")
  })

  it("rejects missing tenant, Principal, Market identity or invalid country codes before persistence", async () => {
    for (const change of [
      { tenantId: "" },
      { principalId: "" },
      { marketId: "bad id" },
      { marketRevision: 0 },
      { shipment: { ...command.shipment, originCountry: "ZZZ" } },
    ]) {
      const records = new MemoryRecords()
      await expect(
        new MedusaFulfilmentAdapter(records).request({ ...command, ...change }),
      ).rejects.toThrow()
      expect(records.record).toBeUndefined()
    }
  })
})
