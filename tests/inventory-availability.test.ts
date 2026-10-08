import type { IInventoryService } from "@medusajs/framework/types"
import { describe, expect, it, vi } from "vitest"
import { MedusaInventoryAvailabilityAdapter } from "../src/baobab/inventory"

const buildFakeInventoryService = () => {
  const levels = [
    {
      inventory_item_id: "iitem_1",
      location_id: "loc_1",
      stocked_quantity: 100,
      reserved_quantity: 20,
      incoming_quantity: 0,
      available_quantity: 80,
    },
  ]
  return {
    listInventoryLevels: vi.fn(async () => levels),
    createReservationItems: vi.fn(async () => ({ id: "resitem_1" })),
    deleteReservationItems: vi.fn(async () => undefined),
  }
}

describe("InventoryAvailabilityPort contract (MedusaInventoryAvailabilityAdapter)", () => {
  it("maps Medusa's snake_case inventory levels to the port's availability shape", async () => {
    const inventory = buildFakeInventoryService()
    const adapter = new MedusaInventoryAvailabilityAdapter(
      inventory as unknown as IInventoryService,
    )
    const availability = await adapter.getAvailability("iitem_1")
    expect(availability).toEqual([
      {
        inventoryItemId: "iitem_1",
        locationId: "loc_1",
        stockedQuantity: 100,
        reservedQuantity: 20,
        incomingQuantity: 0,
        availableQuantity: 80,
      },
    ])
    expect(inventory.listInventoryLevels).toHaveBeenCalledWith({ inventory_item_id: "iitem_1" })
  })

  it("only filters by location when locationIds are given", async () => {
    const inventory = buildFakeInventoryService()
    const adapter = new MedusaInventoryAvailabilityAdapter(
      inventory as unknown as IInventoryService,
    )
    await adapter.getAvailability("iitem_1", ["loc_1", "loc_2"])
    expect(inventory.listInventoryLevels).toHaveBeenCalledWith({
      inventory_item_id: "iitem_1",
      location_id: ["loc_1", "loc_2"],
    })
  })

  it("rejects a non-positive or non-integer reservation quantity without calling Medusa", async () => {
    const inventory = buildFakeInventoryService()
    const adapter = new MedusaInventoryAvailabilityAdapter(
      inventory as unknown as IInventoryService,
    )
    await expect(
      adapter.reserve({
        inventoryItemId: "iitem_1",
        locationId: "loc_1",
        quantity: 0,
        correlationId: "corr-1",
      }),
    ).rejects.toThrow("positive integer")
    await expect(
      adapter.reserve({
        inventoryItemId: "iitem_1",
        locationId: "loc_1",
        quantity: 1.5,
        correlationId: "corr-1",
      }),
    ).rejects.toThrow("positive integer")
    expect(inventory.createReservationItems).not.toHaveBeenCalled()
  })

  it("reserves against a real inventory item/location, disallowing backorder, and returns the reservation id", async () => {
    const inventory = buildFakeInventoryService()
    const adapter = new MedusaInventoryAvailabilityAdapter(
      inventory as unknown as IInventoryService,
    )
    const reservationId = await adapter.reserve({
      inventoryItemId: "iitem_1",
      locationId: "loc_1",
      quantity: 5,
      lineItemId: "item_1",
      correlationId: "corr-1",
    })
    expect(reservationId).toBe("resitem_1")
    expect(inventory.createReservationItems).toHaveBeenCalledWith({
      inventory_item_id: "iitem_1",
      location_id: "loc_1",
      quantity: 5,
      line_item_id: "item_1",
      allow_backorder: false,
      created_by: "baobab-trade",
      metadata: { correlation_id: "corr-1" },
    })
  })

  it("releases a reservation by id", async () => {
    const inventory = buildFakeInventoryService()
    const adapter = new MedusaInventoryAvailabilityAdapter(
      inventory as unknown as IInventoryService,
    )
    await adapter.release("resitem_1")
    expect(inventory.deleteReservationItems).toHaveBeenCalledWith("resitem_1")
  })
})
