import type { BigNumberInput, IInventoryService } from "@medusajs/framework/types"
import { MathBN } from "@medusajs/framework/utils"

export type InventoryAvailability = {
  inventoryItemId: string
  locationId: string
  stockedQuantity: string
  reservedQuantity: string
  incomingQuantity: string
  availableQuantity: string
}

export interface InventoryAvailabilityPort {
  getAvailability(inventoryItemId: string, locationIds?: string[]): Promise<InventoryAvailability[]>
}

const requiredIdentity = (value: unknown, name: string): void => {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`Inventory ${name} must be an explicit native identifier`)
  }
}

const exactNonNegativeQuantity = (value: unknown, field: string): string => {
  try {
    const quantity = MathBN.convert(value as BigNumberInput)
    if (!quantity.isFinite() || quantity.isNegative()) {
      throw new Error("invalid")
    }
    return quantity.toFixed()
  } catch {
    throw new Error(`Invalid native Inventory ${field} quantity`)
  }
}

/**
 * ADR-0013 INV-COM-003/007/013/015/018/028. Read Medusa's native inventory
 * levels and preserve its computed available_quantity. Do not recompute ATS
 * from ERP physical stock or stocked-minus-reserved.
 *
 * Reservation creation/release remains exclusively in Medusa's native cart
 * and order workflows. This read adapter is NOT a tenant/IAM PEP; its caller
 * must establish authorised location, tenant, stock owner and Market scope.
 */
export class MedusaInventoryAvailabilityAdapter implements InventoryAvailabilityPort {
  constructor(private readonly inventory: IInventoryService) {}

  async getAvailability(
    inventoryItemId: string,
    locationIds?: string[],
  ): Promise<InventoryAvailability[]> {
    requiredIdentity(inventoryItemId, "item")
    if (locationIds !== undefined) {
      if (
        !Array.isArray(locationIds) ||
        locationIds.length === 0 ||
        new Set(locationIds).size !== locationIds.length
      ) {
        throw new Error("Inventory locations must be an explicit nonempty unique set")
      }
      for (const id of locationIds) requiredIdentity(id, "location")
    }
    const levels = await this.inventory.listInventoryLevels({
      inventory_item_id: inventoryItemId,
      ...(locationIds === undefined ? {} : { location_id: locationIds }),
    })
    const allowed = locationIds === undefined ? null : new Set(locationIds)
    const seen = new Set<string>()
    return levels.map((level) => {
      if (
        level.inventory_item_id !== inventoryItemId ||
        !level.location_id ||
        (allowed !== null && !allowed.has(level.location_id)) ||
        seen.has(level.location_id)
      ) {
        throw new Error("Native inventory response contains foreign or ambiguous location facts")
      }
      seen.add(level.location_id)
      return {
        inventoryItemId: level.inventory_item_id,
        locationId: level.location_id,
        stockedQuantity: exactNonNegativeQuantity(level.stocked_quantity, "stocked"),
        reservedQuantity: exactNonNegativeQuantity(level.reserved_quantity, "reserved"),
        incomingQuantity: exactNonNegativeQuantity(level.incoming_quantity, "incoming"),
        // This is Medusa's computed commerce ATS, including its own policy deductions.
        availableQuantity: exactNonNegativeQuantity(level.available_quantity, "available-to-sell"),
      }
    })
  }
}
