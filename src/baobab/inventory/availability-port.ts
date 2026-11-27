import type {
  BigNumberInput,
  IInventoryService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { MathBN } from "@medusajs/framework/utils"
import {
  createReservationsWorkflow,
  deleteReservationsWorkflow,
} from "@medusajs/medusa/core-flows"

export type InventoryAvailability = {
  inventoryItemId: string
  locationId: string
  stockedQuantity: string
  reservedQuantity: string
  incomingQuantity: string
  availableQuantity: string
}

export type ReservationRequest = {
  inventoryItemId: string
  locationId: string
  // Quantity is already expressed in native inventory-item units, after the
  // caller applies Medusa's required_quantity conversion for the variant.
  quantity: BigNumberInput
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
 * ADR-0013 INV-COM-003/007/013/015/018/028. Medusa owns reservation and
 * availability semantics; preserve its computed available_quantity rather
 * than recomputing from ERP physical stock or stocked-minus-reserved.
 *
 * This internal adapter is NOT a tenant/IAM PEP. Its caller must first
 * establish authorised location, tenant, stock owner and Market scope.
 */
export class MedusaInventoryAvailabilityAdapter implements InventoryAvailabilityPort {
  constructor(
    private readonly inventory: IInventoryService,
    private readonly container: MedusaContainer,
  ) {}

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

  async reserve(request: ReservationRequest): Promise<string> {
    requiredIdentity(request.inventoryItemId, "item")
    requiredIdentity(request.locationId, "location")
    requiredIdentity(request.correlationId, "correlation")
    if (request.lineItemId !== undefined) requiredIdentity(request.lineItemId, "line item")
    const quantity = exactNonNegativeQuantity(request.quantity, "reservation")
    if (!MathBN.gt(quantity, 0)) {
      throw new Error("Reservation quantity must be positive")
    }

    // Use Medusa's native workflow so inventory validation, compensation and
    // reservation-item.created event semantics are retained.
    const { result } = await createReservationsWorkflow(this.container).run({
      input: {
        reservations: [
          {
            inventory_item_id: request.inventoryItemId,
            location_id: request.locationId,
            quantity,
            line_item_id: request.lineItemId,
            allow_backorder: false,
            created_by: "baobab-trade",
            metadata: { correlation_id: request.correlationId },
          },
        ],
      },
    })
    const reservation = result?.[0]
    if (
      !reservation?.id ||
      reservation.inventory_item_id !== request.inventoryItemId ||
      reservation.location_id !== request.locationId ||
      !MathBN.eq(reservation.quantity, quantity)
    ) {
      throw new Error("Medusa reservation workflow did not return the exact committed reservation")
    }
    return reservation.id
  }

  async release(reservationId: string): Promise<void> {
    requiredIdentity(reservationId, "reservation")
    await deleteReservationsWorkflow(this.container).run({
      input: { ids: [reservationId] },
    })
  }
}
