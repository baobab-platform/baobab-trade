import { Module } from "@medusajs/framework/utils"
import FulfilmentBridgeModuleService from "./service"
export const FULFILMENT_BRIDGE_MODULE = "fulfilmentBridge"
export default Module(FULFILMENT_BRIDGE_MODULE, { service: FulfilmentBridgeModuleService })
