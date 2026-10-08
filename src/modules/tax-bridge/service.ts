import { MedusaService } from "@medusajs/framework/utils"
import B2BTaxProfile from "./models/b2b-tax-profile"
import TaxDetermination from "./models/tax-determination"
import TaxPolicyBinding from "./models/tax-policy-binding"
import TaxReconciliation from "./models/tax-reconciliation"
import TaxRuleProjection from "./models/tax-rule-projection"
import TaxCategoryProjection from "./models/tax-category-projection"
class TaxBridgeModuleService extends MedusaService({
  B2BTaxProfile,
  TaxDetermination,
  TaxPolicyBinding,
  TaxReconciliation,
  TaxRuleProjection,
  TaxCategoryProjection,
}) {}
export default TaxBridgeModuleService
