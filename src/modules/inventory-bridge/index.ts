import { Module } from "@medusajs/framework/utils"
import InventoryBridgeModuleService from "./service"

export const INVENTORY_BRIDGE_MODULE = "inventoryBridge"

export default Module(INVENTORY_BRIDGE_MODULE, {
  service: InventoryBridgeModuleService,
})
