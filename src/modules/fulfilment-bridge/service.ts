import { MedusaService } from "@medusajs/framework/utils"
import CommerceFulfilment from "./models/commerce-fulfilment"
import FulfilmentPolicyBinding from "./models/fulfilment-policy-binding"
import FulfilmentReconciliation from "./models/fulfilment-reconciliation"
import FulfilmentStatusTransition from "./models/fulfilment-status-transition"
import FulfilmentAllocation from "./models/fulfilment-allocation"
import CommerceReturn from "./models/commerce-return"
import FulfilmentOrderLine from "./models/fulfilment-order-line"
class FulfilmentBridgeModuleService extends MedusaService({
  CommerceFulfilment,
  FulfilmentPolicyBinding,
  FulfilmentReconciliation,
  FulfilmentStatusTransition,
  FulfilmentAllocation,
  CommerceReturn,
  FulfilmentOrderLine,
}) {}
export default FulfilmentBridgeModuleService
