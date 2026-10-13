import { Module } from "@medusajs/framework/utils"
import NativeSellerCheckoutModuleService from "./service"
import { NATIVE_SELLER_DEPENDENCY_KEY } from "../../baobab/orders/native-cart-legal-seller"

/** Storage is always installed. External checkout ports remain guarded and lazy. */
export default Module(NATIVE_SELLER_DEPENDENCY_KEY, {
  service: NativeSellerCheckoutModuleService,
})
