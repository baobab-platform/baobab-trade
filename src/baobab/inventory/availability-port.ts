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

const requiredIdentity = (value: unknown, name: string): void => {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`Inventory ${name} must be an explicit native identifier`)
  }
}

const safeQuantity = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid native Inventory ${field} quantity`)
  }
  return value
}

/**
 * ADR-0013 INV-COM-003/007/013/015/018/028. Medusa owns reservation and
 * availability semantics; do not recompute available_quantity from the
 * physical ERP balance or accept foreign native inventory rows.
 *
 * This internal adapter is NOT a tenant/IAM PEP. Its caller must first
 * establish authorised location, tenant, stock owner and Market scope.
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
        stockedQuantity: safeQuantity(level.stocked_quantity, "stocked"),
        reservedQuantity: safeQuantity(level.reserved_quantity, "reserved"),
        incomingQuantity: safeQuantity(level.incoming_quantity, "incoming"),
        // Medusa calculates commerce availability, potentially with policy
        // deductions. Do not substitute ERP on-hand or incoming stock here.
        availableQuantity: safeQuantity(level.available_quantity, "available-to-sell"),
      }
    })
  }

  async reserve(request: ReservationRequest): Promise<string> {
    requiredIdentity(request.inventoryItemId, "item")
    requiredIdentity(request.locationId, "location")
    requiredIdentity(request.correlationId, "correlation")
    if (request.lineItemId !== undefined) requiredIdentity(request.lineItemId, "line item")
    if (!Number.isSafeInteger(request.quantity) || request.quantity <= 0) {
      throw new Error("Reservation quantity must be a positive integer")
    }
    // Native Medusa must perform the actual concurrency/stock check; this
    // wrapper is not an atomic reserve or a preflight ATS proof.
    const reservation = await this.inventory.createReservationItems({
      inventory_item_id: request.inventoryItemId,
      location_id: request.locationId,
      quantity: request.quantity,
      line_item_id: request.lineItemId,
      allow_backorder: false,
      created_by: "baobab-trade",
      metadata: { correlation_id: request.correlationId },
    })
    if (!reservation?.id) {
      throw new Error("Medusa did not return a committed reservation identifier")
    }
    return reservation.id
  }

  async release(reservationId: string): Promise<void> {
    requiredIdentity(reservationId, "reservation")
    await this.inventory.deleteReservationItems(reservationId)
  }
}
