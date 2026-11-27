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
        stockedQuantity: "100",
        reservedQuantity: "20",
        incomingQuantity: "0",
        availableQuantity: "80",
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

  it("preserves Medusa computed availability when it differs from stock minus reservations", async () => {
    const inventory = buildFakeInventoryService()
    inventory.listInventoryLevels.mockResolvedValue([
      {
        inventory_item_id: "iitem_1",
        location_id: "loc_1",
        stocked_quantity: 100,
        reserved_quantity: 20,
        incoming_quantity: 0,
        available_quantity: 73,
      },
    ])
    const adapter = new MedusaInventoryAvailabilityAdapter(
      inventory as unknown as IInventoryService,
    )
    await expect(adapter.getAvailability("iitem_1", ["loc_1"])).resolves.toMatchObject([
      { availableQuantity: "73" },
    ])
  })
})
