import { Module } from "@medusajs/framework/utils"
import PaymentBridgeModuleService from "./service"

export const PAYMENT_BRIDGE_MODULE = "paymentBridge"

export default Module(PAYMENT_BRIDGE_MODULE, { service: PaymentBridgeModuleService })
