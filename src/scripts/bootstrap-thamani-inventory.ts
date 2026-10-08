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
import { reconcileInventory } from "../baobab/inventory"
import { findByMetadataKey } from "../baobab/market/mapping"
import { THAMANI_CATALOGUE } from "../baobab/thamani/catalogue"
import {
  THAMANI_INVENTORY_LOCATIONS,
  locationsForProduct,
  thamaniInventoryLocationMetadata,
} from "../baobab/thamani/inventory"
import type InventoryBridgeModuleService from "../modules/inventory-bridge/service"

export default async function bootstrapThamaniInventory({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve("logger")
  const stockLocations = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const salesChannels = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
  const bridge = container.resolve<InventoryBridgeModuleService>("inventoryBridge")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as {
    create(links: Record<string, Record<string, string>>[]): Promise<unknown>
  }
  const salesChannel = findByMetadataKey(
    await salesChannels.listSalesChannels({}),
    "baobab_sales_channel_key",
    "thamani_b2c",
  )
  if (!salesChannel)
    throw new Error("Run bootstrap:thamani-market before bootstrap:thamani-inventory")

  const resolved = new Map<string, { id: string }>()
  for (const config of THAMANI_INVENTORY_LOCATIONS) {
    const all = await stockLocations.listStockLocations({})
    let location = findByMetadataKey(all, "baobab_canonical_location_key", config.canonicalKey)
    if (!location && config.reusesMarketPrimary)
      location = findByMetadataKey(all, "baobab_market_key", config.marketKey)
    if (location) {
      location = await stockLocations.updateStockLocations(location.id, {
        name: `${config.canonicalKey} ${config.name}`,
        metadata: { ...(location.metadata ?? {}), ...thamaniInventoryLocationMetadata(config) },
      })
    } else {
      location = await stockLocations.createStockLocations({
        name: `${config.canonicalKey} ${config.name}`,
        address: {
          address_1: config.addressLine,
          city: config.city,
          country_code: config.countryCode.toLowerCase(),
        },
        metadata: thamaniInventoryLocationMetadata(config),
      })
    }
    const { data: locationLinks } = await query.graph({
      entity: "stock_location",
      fields: ["id", "sales_channels.id", "fulfillment_providers.id"],
      filters: { id: location.id },
    })
    const linkedLocation = locationLinks[0] as {
      sales_channels?: { id: string }[]
      fulfillment_providers?: { id: string }[]
    }
    if (!linkedLocation?.sales_channels?.some((channel) => channel.id === salesChannel.id)) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: location.id, add: [salesChannel.id], remove: [] },
      })
    }
    if (
      !linkedLocation?.fulfillment_providers?.some((provider) => provider.id === "manual_manual")
    ) {
      await remoteLink.create([
        {
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
        },
      ])
    }
    const [mapping] = await bridge.listLocationMappings({ stock_location_id: location.id })
    if (!mapping)
      await bridge.createLocationMappings({
        stock_location_id: location.id,
        canonical_location_key: config.canonicalKey,
        erp_warehouse_reference: config.erpWarehouseReference,
        market_key: config.marketKey,
        status: "ACTIVE",
      })
    resolved.set(config.canonicalKey, location)
  }

  for (const product of THAMANI_CATALOGUE) {
    const [item] = await inventory.listInventoryItems({ sku: product.sku })
    if (!item) throw new Error(`Run bootstrap:thamani-catalogue first; missing ${product.sku}`)
    for (const config of locationsForProduct(product)) {
      const location = resolved.get(config.canonicalKey)
      if (!location) throw new Error(`Unresolved Thamani location ${config.canonicalKey}`)
      let [level] = await inventory.listInventoryLevels({
        inventory_item_id: item.id,
        location_id: location.id,
      })
      if (!level) {
        const { result } = await createInventoryLevelsWorkflow(container).run({
          input: {
            inventory_levels: [
              {
                inventory_item_id: item.id,
                location_id: location.id,
                stocked_quantity: config.initialQuantity,
                incoming_quantity: 0,
              },
            ],
          },
        })
        level = result[0]
      }
      const key = `idempiere:thamani:${product.sku}:${config.canonicalKey}:1`
      let [projection] = await bridge.listInventoryProjections({ source_idempotency_key: key })
      if (!projection) {
        const now = new Date()
        projection = await bridge.createInventoryProjections({
          inventory_item_id: item.id,
          stock_location_id: location.id,
          erp_warehouse_reference: config.erpWarehouseReference,
          source_sequence: 1,
          source_idempotency_key: key,
          on_hand_quantity: config.initialQuantity,
          incoming_quantity: 0,
          unavailable_quantity: 0,
          projected_at: now,
          applied_at: now,
        })
      }
      const [existing] = await bridge.listInventoryReconciliations({ projection_id: projection.id })
      if (!existing) {
        const result = reconcileInventory({
          erpOnHand: projection.on_hand_quantity,
          medusaStocked: level.stocked_quantity,
          medusaReserved: level.reserved_quantity,
        })
        await bridge.createInventoryReconciliations({
          projection_id: projection.id,
          inventory_item_id: item.id,
          stock_location_id: location.id,
          erp_on_hand_quantity: result.erpOnHand,
          medusa_stocked_quantity: result.medusaStocked,
          medusa_reserved_quantity: result.medusaReserved,
          delta_quantity: result.delta,
          status: result.status,
          observed_at: new Date(),
        })
      }
    }
  }
  logger.info("Bootstrapped Thamani Gate 10 multi-location inventory projections")
}
