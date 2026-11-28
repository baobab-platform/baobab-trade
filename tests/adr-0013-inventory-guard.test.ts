import type { IInventoryService } from "@medusajs/framework/types"
import { describe, expect, it, vi } from "vitest"
import { MedusaInventoryAvailabilityAdapter } from "../src/baobab/inventory/availability-port"
import {
  assertProjectionSequence,
  reconcileInventory,
} from "../src/baobab/inventory/reconciliation"

const native = (rows: Record<string, unknown>[]) => ({
  listInventoryLevels: vi.fn(async () => rows),
})
const row = {
  inventory_item_id: "iitem_za",
  location_id: "loc_za",
  stocked_quantity: "30.5",
  reserved_quantity: "10.25",
  incoming_quantity: "5.75",
  available_quantity: "17.125",
}
const adapter = (db: ReturnType<typeof native>) =>
  new MedusaInventoryAvailabilityAdapter(db as unknown as IInventoryService)

describe("ADR-0013 native Commerce inventory authority guards", () => {
  it("preserves Medusa computed ATS and exact fractional inventory quantities", async () => {
    const db = native([row])
    const result = await adapter(db).getAvailability("iitem_za", ["loc_za"])
    expect(result).toEqual([
      {
        inventoryItemId: "iitem_za",
        locationId: "loc_za",
        stockedQuantity: "30.5",
        reservedQuantity: "10.25",
        incomingQuantity: "5.75",
        availableQuantity: "17.125",
      },
    ])
  })

  it("refuses a backend returning another item or location despite filters", async () => {
    for (const override of [{ inventory_item_id: "iitem_other" }, { location_id: "loc_other" }]) {
      const db = native([{ ...row, ...override }])
      await expect(adapter(db).getAvailability("iitem_za", ["loc_za"])).rejects.toThrow(
        "foreign or ambiguous",
      )
    }
  })

  it("refuses duplicate level rows for the same item and location", async () => {
    await expect(adapter(native([row, row])).getAvailability("iitem_za")).rejects.toThrow(
      "foreign or ambiguous",
    )
  })

  it("does not expose malformed or negative stock projections", async () => {
    for (const field of [
      "stocked_quantity",
      "reserved_quantity",
      "incoming_quantity",
      "available_quantity",
    ]) {
      for (const value of [
        null,
        undefined,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
        "not-a-number",
      ]) {
        const db = native([{ ...row, [field]: value }])
        await expect(adapter(db).getAvailability("iitem_za")).rejects.toThrow(
          "Invalid native Inventory",
        )
      }
    }
  })

  it("rejects ambiguous location selection before querying native inventory", async () => {
    const db = native([])
    for (const ids of [[], ["loc_za", "loc_za"], [""]]) {
      await expect(adapter(db).getAvailability("iitem_za", ids)).rejects.toThrow()
    }
    expect(db.listInventoryLevels).not.toHaveBeenCalled()
  })

  it("reconciles exact decimal quantities and preserves Medusa available_quantity", () => {
    const result = reconcileInventory({
      erpOnHand: "12.25",
      medusaStocked: "12.5",
      medusaReserved: "2.25",
      medusaAvailable: "9.875",
    })
    expect(result).toEqual({
      erpOnHand: "12.25",
      medusaStocked: "12.5",
      medusaReserved: "2.25",
      medusaAvailable: "9.875",
      delta: "0.25",
      status: "VARIANCE",
    })
  })

  it("rejects invalid reconciliation quantities and sequence values", () => {
    expect(() =>
      reconcileInventory({
        erpOnHand: "NaN",
        medusaStocked: "12",
        medusaReserved: "2",
        medusaAvailable: "10",
      }),
    ).toThrow("erpOnHand")
    expect(() =>
      reconcileInventory({
        erpOnHand: "-1",
        medusaStocked: "12",
        medusaReserved: "2",
        medusaAvailable: "10",
      }),
    ).toThrow("erpOnHand")
    expect(() => assertProjectionSequence(null, Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "positive integer",
    )
    expect(() => assertProjectionSequence(Number.MAX_SAFE_INTEGER + 1, 20)).toThrow(
      "Stale or replayed",
    )
  })
})
