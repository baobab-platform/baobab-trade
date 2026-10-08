import { Module } from "@medusajs/framework/utils"
import TradeReadinessModuleService from "./service"
export const TRADE_READINESS_MODULE = "tradeReadiness"
export default Module(TRADE_READINESS_MODULE, { service: TradeReadinessModuleService })
