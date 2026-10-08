import { MedusaService } from "@medusajs/framework/utils"
import CrossBorderTransaction from "./models/cross-border-transaction"
import TradeComplianceDecision from "./models/trade-compliance-decision"
import TradeLanePolicy from "./models/trade-lane-policy"
import ThamaniTradeProfile from "./models/thamani-trade-profile"
class TradeReadinessModuleService extends MedusaService({
  CrossBorderTransaction,
  TradeComplianceDecision,
  TradeLanePolicy,
  ThamaniTradeProfile,
}) {}
export default TradeReadinessModuleService
