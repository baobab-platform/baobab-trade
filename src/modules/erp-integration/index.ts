import { Module } from "@medusajs/framework/utils"
import ErpIntegrationModuleService from "./service"
export const ERP_INTEGRATION_MODULE = "erpIntegration"
export default Module(ERP_INTEGRATION_MODULE, { service: ErpIntegrationModuleService })
