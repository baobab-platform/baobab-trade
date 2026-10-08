import { MedusaService } from "@medusajs/framework/utils"
import Supplier from "./models/supplier"
import ProductRetailProfile from "./models/product-retail-profile"
import MarketProductEligibility from "./models/market-product-eligibility"

class ThamaniModuleService extends MedusaService({
  Supplier,
  ProductRetailProfile,
  MarketProductEligibility,
}) {}

export default ThamaniModuleService
