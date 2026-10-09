import { Module } from "@medusajs/framework/utils"
import NativeSellerCheckoutModuleService from "./service"
import { NATIVE_SELLER_DEPENDENCY_KEY } from "../../baobab/orders/native-cart-legal-seller"

/** Staging only. Module is not loaded when native checkout enforcement is off. */
export default Module(NATIVE_SELLER_DEPENDENCY_KEY, {
  service: NativeSellerCheckoutModuleService,
})
