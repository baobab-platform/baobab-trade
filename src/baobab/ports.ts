import type { FulfilmentPort } from "./fulfilment"
import type { InventoryAvailabilityPort } from "./inventory"
import type { LedgerEvidencePort } from "./ledger"
import type { OrderOrchestrationPort } from "./orders"
import type { PaymentOrchestrationPort } from "./payments"
import type { PricingDecisionPort } from "./pricing"
import type { TradeCompliancePort } from "./trade-readiness/compliance-port"
export type CommerceCapabilityPorts = {
  orders: OrderOrchestrationPort
  inventory: InventoryAvailabilityPort
  pricing: PricingDecisionPort
  payments: PaymentOrchestrationPort
  fulfilment: FulfilmentPort
  tradeCompliance: TradeCompliancePort
  ledgerEvidence: LedgerEvidencePort
}
export const NATIVE_CAPABILITY_BINDINGS = {
  orders: "MEDUSA_NATIVE",
  inventory: "MEDUSA_NATIVE",
  pricing: "MEDUSA_NATIVE",
  payments: "MEDUSA_NATIVE",
  fulfilment: "MEDUSA_NATIVE",
  tradeCompliance: "PROJECTED_ADAPTER",
  ledgerEvidence: "DISABLED_BOUNDARY",
} as const
