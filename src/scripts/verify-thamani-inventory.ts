import type { ExecArgs, IInventoryService, IStockLocationService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { MedusaInventoryAvailabilityAdapter } from "../baobab/inventory"
import { findByMetadataKey } from "../baobab/market/mapping"
import { THAMANI_CATALOGUE } from "../baobab/thamani/catalogue"
import { THAMANI_INVENTORY_LOCATIONS, locationsForProduct } from "../baobab/thamani/inventory"
import type InventoryBridgeModuleService from "../modules/inventory-bridge/service"

export default async function verifyThamaniInventory({ container }: ExecArgs): Promise<void> {
  const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
  const stockLocations = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const bridge = container.resolve<InventoryBridgeModuleService>("inventoryBridge")
  const allLocations = await stockLocations.listStockLocations({})
  const locations = THAMANI_INVENTORY_LOCATIONS.map((config) => {
    const location = findByMetadataKey(
      allLocations,
      "baobab_canonical_location_key",
      config.canonicalKey,
    )
    if (!location || location.metadata?.baobab_digital_estate !== "thamani_b2c")
      throw new Error(`Isolated Thamani location ${config.canonicalKey} is missing`)
    return location
  })
  const items = await inventory.listInventoryItems({
    sku: THAMANI_CATALOGUE.map((product) => product.sku),
  })
  if (items.length !== THAMANI_CATALOGUE.length)
    throw new Error(
      `Expected ${THAMANI_CATALOGUE.length} Thamani inventory items, found ${items.length}`,
    )
  const expectedLevels = THAMANI_CATALOGUE.reduce(
    (sum, product) => sum + locationsForProduct(product).length,
    0,
  )
  const itemIds = items.map((item) => item.id)
  const locationIds = locations.map((location) => location.id)
  const canonicalKeyByLocationId = new Map(
    locations.map((location) => [
      location.id,
      String(location.metadata?.baobab_canonical_location_key),
    ]),
  )
  const [levels, projections, reconciliations] = await Promise.all([
    inventory.listInventoryLevels({ inventory_item_id: itemIds, location_id: locationIds }),
    bridge.listInventoryProjections({ inventory_item_id: itemIds, stock_location_id: locationIds }),
    bridge.listInventoryReconciliations({
      inventory_item_id: itemIds,
      stock_location_id: locationIds,
    }),
  ])
  if (levels.length !== expectedLevels || projections.length !== expectedLevels)
    throw new Error(
      `Expected ${expectedLevels} Market-eligible levels/projections; found ${levels.length}/${projections.length}`,
    )
  if (reconciliations.length !== expectedLevels)
    throw new Error(
      `Expected ${expectedLevels} Thamani reconciliation records, found ${reconciliations.length}`,
    )
  for (const record of reconciliations) {
    const expectedDelta =
      Number(record.medusa_stocked_quantity) - Number(record.erp_on_hand_quantity)
    const expectedStatus = expectedDelta === 0 ? "MATCHED" : "VARIANCE"
    if (Number(record.delta_quantity) !== expectedDelta || record.status !== expectedStatus) {
      throw new Error(`Inconsistent inventory reconciliation ${record.id}`)
    }
  }

  for (const product of THAMANI_CATALOGUE.filter((entry) => entry.eligibleMarkets.length === 1)) {
    const item = items.find((entry) => entry.sku === product.sku)
    if (!item) throw new Error(`Missing Thamani inventory item ${product.sku}`)
    const productLevels = levels.filter((level) => level.inventory_item_id === item.id)
    const permitted = new Set(locationsForProduct(product).map((config) => config.canonicalKey))
    const actual = productLevels.map((level) => {
      const key = canonicalKeyByLocationId.get(level.location_id)
      if (!key) throw new Error(`Unknown Thamani location ${level.location_id}`)
      return key
    })
    if (actual.some((key) => !permitted.has(key)))
      throw new Error(`${product.sku} leaked inventory into an ineligible Market`)
  }

  const adapter = new MedusaInventoryAvailabilityAdapter(inventory)
  const item = items[0]
  const location = locations[0]
  const [before] = await adapter.getAvailability(item.id, [location.id])
  const reservationId = await adapter.reserve({
    inventoryItemId: item.id,
    locationId: location.id,
    quantity: 1,
    correlationId: "thamani-gate-10-reservation-check",
  })
  try {
    const [during] = await adapter.getAvailability(item.id, [location.id])
    if (during.reservedQuantity !== before.reservedQuantity + 1)
      throw new Error("Reservation was not reflected in Thamani inventory")
  } finally {
    await adapter.release(reservationId)
  }
  container
    .resolve("logger")
    .info("Verified Thamani Gate 10 inventory, reservations, isolation, and ERP reconciliation")
}
