import { Module } from "@medusajs/framework/utils"
import ThamaniModuleService from "./service"

export const THAMANI_MODULE = "thamani"

export default Module(THAMANI_MODULE, {
  service: ThamaniModuleService,
})
