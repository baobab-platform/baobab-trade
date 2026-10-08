import type { ExecArgs, IInventoryService, IStockLocationService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ZURIBEANS_CATALOGUE } from "../baobab/catalogue"
import {
  MedusaInventoryAvailabilityAdapter,
  ZURIBEANS_INVENTORY_LOCATIONS,
} from "../baobab/inventory"
import { findByMetadataKey } from "../baobab/market/mapping"
import type InventoryBridgeModuleService from "../modules/inventory-bridge/service"

export default async function verifyInventory({ container }: ExecArgs): Promise<void> {
  const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
  const stockLocationService = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const inventoryBridge = container.resolve<InventoryBridgeModuleService>("inventoryBridge")
  const locations = await stockLocationService.listStockLocations({})

  const projectedLocations = ZURIBEANS_INVENTORY_LOCATIONS.map((config) => {
    const location = findByMetadataKey(locations, "baobab_canonical_location_key", config.code)
    if (!location) throw new Error(`Canonical Stock Location ${config.code} is missing`)
    if (location.metadata?.baobab_erp_warehouse_reference !== config.erpWarehouseReference) {
      throw new Error(`ERP Warehouse mapping mismatch for ${config.code}`)
    }
    return location
  })

  const items = await inventoryService.listInventoryItems({
    sku: ZURIBEANS_CATALOGUE.map((product) => product.sku),
  })
  if (items.length !== 10) throw new Error(`Expected 10 inventory items, found ${items.length}`)

  const [levels, mappings, projections, reconciliations] = await Promise.all([
    inventoryService.listInventoryLevels({
      inventory_item_id: items.map((item) => item.id),
      location_id: projectedLocations.map((location) => location.id),
    }),
    inventoryBridge.listLocationMappings({}),
    inventoryBridge.listInventoryProjections({}),
    inventoryBridge.listInventoryReconciliations({}),
  ])
  if (levels.length !== 60) throw new Error(`Expected 60 inventory levels, found ${levels.length}`)
  if (mappings.length !== 6)
    throw new Error(`Expected 6 location mappings, found ${mappings.length}`)
  if (projections.length !== 60) {
    throw new Error(`Expected 60 ERP projections, found ${projections.length}`)
  }
  if (
    reconciliations.length !== 60 ||
    reconciliations.some((record) => record.status !== "MATCHED")
  ) {
    throw new Error("Initial ERP projections are not fully reconciled")
  }

  const adapter = new MedusaInventoryAvailabilityAdapter(inventoryService)
  const item = items[0]
  const location = projectedLocations[0]
  const [before] = await adapter.getAvailability(item.id, [location.id])
  const reservationId = await adapter.reserve({
    inventoryItemId: item.id,
    locationId: location.id,
    quantity: 1,
    correlationId: "gate-7-ci-reservation-check",
  })
  try {
    const [reserved] = await adapter.getAvailability(item.id, [location.id])
    if (reserved.reservedQuantity !== before.reservedQuantity + 1) {
      throw new Error("Medusa reservation did not reduce commerce availability")
    }
  } finally {
    await adapter.release(reservationId)
  }
  const [released] = await adapter.getAvailability(item.id, [location.id])
  if (released.reservedQuantity !== before.reservedQuantity) {
    throw new Error("Released reservation did not restore commerce availability")
  }

  container.resolve("logger").info("Verified Gate 7 inventory, reservation, and reconciliation")
}
