import { describe, expect, it } from "vitest"
import { reconcileFulfilment } from "../src/baobab/fulfilment"
describe("fulfilment reconciliation", () => {
  it("records missing execution and shipment mappings", () => {
    expect(reconcileFulfilment({ commerceStatus: "REQUESTED" }).status).toBe("PENDING_EXECUTION")
    expect(
      reconcileFulfilment({ commerceStatus: "DISPATCHED", executionStatus: "DISPATCHED" }),
    ).toEqual({ status: "VARIANCE", reasons: ["SHIPMENT_MAPPING_MISSING"] })
  })
  it("matches correlated execution evidence", () => {
    expect(
      reconcileFulfilment({
        commerceStatus: "DELIVERED",
        executionStatus: "DELIVERED",
        shipmentReference: "shipment-1",
      }).status,
    ).toBe("MATCHED")
  })
})
