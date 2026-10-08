import { Module } from "@medusajs/framework/utils"
import EventOutboxModuleService from "./service"
export const EVENT_OUTBOX_MODULE = "eventOutbox"
export default Module(EVENT_OUTBOX_MODULE, { service: EventOutboxModuleService })
