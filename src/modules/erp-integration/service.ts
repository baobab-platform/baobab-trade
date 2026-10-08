import { MedusaService } from "@medusajs/framework/utils"
import BuyerCommercialProfileProjection from "./models/buyer-commercial-profile-projection"
import ErpEntityMapping from "./models/erp-entity-mapping"
import ErpProjection from "./models/erp-projection"
import ErpReconciliation from "./models/erp-reconciliation"
import FinancialStatusProjection from "./models/financial-status-projection"
class ErpIntegrationModuleService extends MedusaService({
  BuyerCommercialProfileProjection,
  ErpEntityMapping,
  ErpProjection,
  ErpReconciliation,
  FinancialStatusProjection,
}) {}
export default ErpIntegrationModuleService
