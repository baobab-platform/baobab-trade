import { MedusaService } from "@medusajs/framework/utils"
import InventoryProjection from "./models/inventory-projection"
import InventoryReconciliation from "./models/inventory-reconciliation"
import LocationMapping from "./models/location-mapping"

class InventoryBridgeModuleService extends MedusaService({
  InventoryProjection,
  InventoryReconciliation,
  LocationMapping,
}) {}

export default InventoryBridgeModuleService
