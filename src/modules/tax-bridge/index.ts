import { Module } from "@medusajs/framework/utils"
import TaxBridgeModuleService from "./service"
export const TAX_BRIDGE_MODULE = "taxBridge"
export default Module(TAX_BRIDGE_MODULE, { service: TaxBridgeModuleService })
