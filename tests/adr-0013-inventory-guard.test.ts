import type { IInventoryService } from "@medusajs/framework/types"
import { describe, expect, it, vi } from "vitest"
import { MedusaInventoryAvailabilityAdapter } from "../src/baobab/inventory/availability-port"
import {
  assertProjectionSequence,
  reconcileInventory,
} from "../src/baobab/inventory/reconciliation"

const native = (rows: Record<string, unknown>[]) => ({
  listInventoryLevels: vi.fn(async () => rows),
  createReservationItems: vi.fn(async () => ({ id: "res_1" })),
  deleteReservationItems: vi.fn(async () => undefined),
})
const row = {
  inventory_item_id: "iitem_za",
  location_id: "loc_za",
  stocked_quantity: 30,
  reserved_quantity: 10,
  incoming_quantity: 5,
  available_quantity: 17,
}
const adapter = (db: ReturnType<typeof native>) =>
  new MedusaInventoryAvailabilityAdapter(db as unknown as IInventoryService)

describe("ADR-0013 native Commerce inventory authority guards", () => {
  it("preserves Medusa computed ATS, not physical stock minus reserved or incoming", async () => {
    const db = native([row])
    const result = await adapter(db).getAvailability("iitem_za", ["loc_za"])
    expect(result).toEqual([
      {
        inventoryItemId: "iitem_za",
        locationId: "loc_za",
        stockedQuantity: 30,
        reservedQuantity: 10,
        incomingQuantity: 5,
        availableQuantity: 17,
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
  it("does not expose malformed, fractional, negative, NaN or unsafe stock projections", async () => {
    for (const field of [
      "stocked_quantity",
      "reserved_quantity",
      "incoming_quantity",
      "available_quantity",
    ]) {
      for (const value of [-1, 1.25, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
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
  it("refuses invalid reservation identity and quantity before any native effect", async () => {
    const db = native([])
    const positive = {
      inventoryItemId: "iitem_za",
      locationId: "loc_za",
      quantity: 1,
      correlationId: "corr",
    }
    for (const change of [
      { quantity: Number.MAX_SAFE_INTEGER + 1 },
      { inventoryItemId: "" },
      { locationId: "" },
      { correlationId: "" },
      { lineItemId: "" },
    ]) {
      await expect(adapter(db).reserve({ ...positive, ...change })).rejects.toThrow()
    }
    expect(db.createReservationItems).not.toHaveBeenCalled()
  })
  it("rejects empty reservation ID before delete", async () => {
    const db = native([])
    await expect(adapter(db).release("")).rejects.toThrow("identifier")
    expect(db.deleteReservationItems).not.toHaveBeenCalled()
  })
  it("rejects unsafe reconciled facts and sequence values", () => {
    expect(() =>
      reconcileInventory({
        erpOnHand: Number.MAX_SAFE_INTEGER + 1,
        medusaStocked: 1,
        medusaReserved: 0,
      }),
    ).toThrow("non-negative integer")
    expect(() => assertProjectionSequence(null, Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "positive integer",
    )
    expect(() => assertProjectionSequence(Number.MAX_SAFE_INTEGER + 1, 20)).toThrow(
      "Stale or replayed",
    )
  })
})
