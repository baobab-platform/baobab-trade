import {
  createInventoryLevelsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/core-flows"
import type {
  ExecArgs,
  IInventoryService,
  ISalesChannelModuleService,
  IStockLocationService,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ZURIBEANS_CATALOGUE } from "../baobab/catalogue"
import {
  ZURIBEANS_INVENTORY_LOCATIONS,
  inventoryLocationMetadata,
  reconcileInventory,
} from "../baobab/inventory"
import { findByMetadataKey } from "../baobab/market/mapping"
import type InventoryBridgeModuleService from "../modules/inventory-bridge/service"

export default async function bootstrapInventory({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve("logger")
  const stockLocationService = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const salesChannelService = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
  const inventoryBridge = container.resolve<InventoryBridgeModuleService>("inventoryBridge")
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as {
    create(links: Record<string, Record<string, string>>[]): Promise<unknown>
  }

  const salesChannel = findByMetadataKey(
    await salesChannelService.listSalesChannels({}),
    "baobab_sales_channel_key",
    "zuribeans_b2b",
  )
  if (!salesChannel) throw new Error("Run bootstrap:market before bootstrap:inventory")

  const resolvedLocations = new Map<string, { id: string }>()
  for (const config of ZURIBEANS_INVENTORY_LOCATIONS) {
    const locations = await stockLocationService.listStockLocations({})
    let location = findByMetadataKey(locations, "baobab_canonical_location_key", config.code)
    let created = false
    if (!location && config.reusesMarketPrimary) {
      location = findByMetadataKey(locations, "baobab_market_key", config.marketKey)
    }
    if (location) {
      location = await stockLocationService.updateStockLocations(location.id, {
        name: `${config.code} ${config.name}`,
        metadata: { ...(location.metadata ?? {}), ...inventoryLocationMetadata(config) },
      })
    } else {
      location = await stockLocationService.createStockLocations({
        name: `${config.code} ${config.name}`,
        address: {
          address_1: config.addressLine,
          city: config.city,
          country_code: config.countryCode.toLowerCase(),
        },
        metadata: inventoryLocationMetadata(config),
      })
      created = true
    }

    if (created) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: location.id, add: [salesChannel.id], remove: [] },
      })
      await remoteLink.create([
        {
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
        },
      ])
    }

    const [mapping] = await inventoryBridge.listLocationMappings({ stock_location_id: location.id })
    if (!mapping) {
      await inventoryBridge.createLocationMappings({
        stock_location_id: location.id,
        canonical_location_key: config.code,
        erp_warehouse_reference: config.erpWarehouseReference,
        market_key: config.marketKey,
        status: "ACTIVE",
      })
    }
    resolvedLocations.set(config.code, location)
  }

  for (const product of ZURIBEANS_CATALOGUE) {
    const [inventoryItem] = await inventoryService.listInventoryItems({ sku: product.sku })
    if (!inventoryItem)
      throw new Error(`Run bootstrap:catalogue before inventory; missing ${product.sku}`)

    for (const locationConfig of ZURIBEANS_INVENTORY_LOCATIONS) {
      const location = resolvedLocations.get(locationConfig.code)
      if (!location) throw new Error(`Unresolved inventory location ${locationConfig.code}`)
      let [level] = await inventoryService.listInventoryLevels({
        inventory_item_id: inventoryItem.id,
        location_id: location.id,
      })
      if (!level) {
        const { result } = await createInventoryLevelsWorkflow(container).run({
          input: {
            inventory_levels: [
              {
                inventory_item_id: inventoryItem.id,
                location_id: location.id,
                stocked_quantity: locationConfig.initialProjectedPacks,
                incoming_quantity: 0,
              },
            ],
          },
        })
        level = result[0]
      }

      const idempotencyKey = `idempiere:${product.sku}:${locationConfig.code}:1`
      let [projection] = await inventoryBridge.listInventoryProjections({
        source_idempotency_key: idempotencyKey,
      })
      if (!projection) {
        const now = new Date()
        projection = await inventoryBridge.createInventoryProjections({
          inventory_item_id: inventoryItem.id,
          stock_location_id: location.id,
          erp_warehouse_reference: locationConfig.erpWarehouseReference,
          source_sequence: 1,
          source_idempotency_key: idempotencyKey,
          on_hand_quantity: locationConfig.initialProjectedPacks,
          incoming_quantity: 0,
          unavailable_quantity: 0,
          projected_at: now,
          applied_at: now,
        })
      }

      const [existingReconciliation] = await inventoryBridge.listInventoryReconciliations({
        projection_id: projection.id,
      })
      if (!existingReconciliation) {
        const reconciliation = reconcileInventory({
          erpOnHand: projection.on_hand_quantity,
          medusaStocked: level.stocked_quantity,
          medusaReserved: level.reserved_quantity,
        })
        await inventoryBridge.createInventoryReconciliations({
          projection_id: projection.id,
          inventory_item_id: inventoryItem.id,
          stock_location_id: location.id,
          erp_on_hand_quantity: reconciliation.erpOnHand,
          medusa_stocked_quantity: reconciliation.medusaStocked,
          medusa_reserved_quantity: reconciliation.medusaReserved,
          delta_quantity: reconciliation.delta,
          status: reconciliation.status,
          observed_at: new Date(),
        })
      }
    }
  }

  logger.info("Bootstrapped Gate 7 inventory projections across six canonical locations")
}
