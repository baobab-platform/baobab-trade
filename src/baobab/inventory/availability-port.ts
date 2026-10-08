import type { IInventoryService } from "@medusajs/framework/types"

export type InventoryAvailability = {
  inventoryItemId: string
  locationId: string
  stockedQuantity: number
  reservedQuantity: number
  incomingQuantity: number
  availableQuantity: number
}

export type ReservationRequest = {
  inventoryItemId: string
  locationId: string
  quantity: number
  lineItemId?: string
  correlationId: string
}

export interface InventoryAvailabilityPort {
  getAvailability(inventoryItemId: string, locationIds?: string[]): Promise<InventoryAvailability[]>
  reserve(request: ReservationRequest): Promise<string>
  release(reservationId: string): Promise<void>
}

export class MedusaInventoryAvailabilityAdapter implements InventoryAvailabilityPort {
  constructor(private readonly inventory: IInventoryService) {}

  async getAvailability(
    inventoryItemId: string,
    locationIds?: string[],
  ): Promise<InventoryAvailability[]> {
    const levels = await this.inventory.listInventoryLevels({
      inventory_item_id: inventoryItemId,
      ...(locationIds?.length ? { location_id: locationIds } : {}),
    })
    return levels.map((level) => ({
      inventoryItemId: level.inventory_item_id,
      locationId: level.location_id,
      stockedQuantity: level.stocked_quantity,
      reservedQuantity: level.reserved_quantity,
      incomingQuantity: level.incoming_quantity,
      availableQuantity: level.available_quantity,
    }))
  }

  async reserve(request: ReservationRequest): Promise<string> {
    if (!Number.isInteger(request.quantity) || request.quantity <= 0) {
      throw new Error("Reservation quantity must be a positive integer")
    }
    const reservation = await this.inventory.createReservationItems({
      inventory_item_id: request.inventoryItemId,
      location_id: request.locationId,
      quantity: request.quantity,
      line_item_id: request.lineItemId,
      allow_backorder: false,
      created_by: "baobab-trade",
      metadata: { correlation_id: request.correlationId },
    })
    return reservation.id
  }

  async release(reservationId: string): Promise<void> {
    await this.inventory.deleteReservationItems(reservationId)
  }
}
