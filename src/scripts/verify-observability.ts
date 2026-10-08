import type { ExecArgs } from "@medusajs/framework/types"
import {
  RECONCILIATION_SLO_MINUTES,
  summarizeReconciliationSweep,
  TradeMetrics,
  type ReconciliationDomain,
  type ReconciliationOutcomeStatus,
  type ReconciliationSweepItem,
} from "../baobab/observability"
import type FulfilmentBridgeModuleService from "../modules/fulfilment-bridge/service"
import type InventoryBridgeModuleService from "../modules/inventory-bridge/service"
import type PaymentBridgeModuleService from "../modules/payment-bridge/service"
import type TaxBridgeModuleService from "../modules/tax-bridge/service"
import type ErpIntegrationModuleService from "../modules/erp-integration/service"

const ageMinutes = (observedAt: Date): number => (Date.now() - observedAt.getTime()) / 60_000

const toSweepItems = (
  rows: readonly { status: string; observed_at: Date }[],
): ReconciliationSweepItem[] =>
  rows.map((row) => ({
    status: row.status as ReconciliationOutcomeStatus,
    ageMinutes: ageMinutes(row.observed_at),
  }))

/**
 * Gate 20's reconciliation-job sweep, run once here against every
 * reconciliation record the earlier Gate verify/bootstrap scripts already
 * created (Gates 8-12 and their Thamani counterparts) — this is what a
 * scheduled run of the same sweep would do; scheduling it is the
 * deployment platform's job, not this repository's
 * (docs/operations/observability.md). A freshly created record's age is
 * near zero, so every domain is expected to still be within its own SLO
 * immediately after this pipeline created it.
 */
export default async function ({ container }: ExecArgs) {
  const paymentBridge = container.resolve<PaymentBridgeModuleService>("paymentBridge")
  const taxBridge = container.resolve<TaxBridgeModuleService>("taxBridge")
  const fulfilmentBridge = container.resolve<FulfilmentBridgeModuleService>("fulfilmentBridge")
  const inventoryBridge = container.resolve<InventoryBridgeModuleService>("inventoryBridge")
  const erp = container.resolve<ErpIntegrationModuleService>("erpIntegration")
  const metrics = new TradeMetrics()

  const sweeps: Record<ReconciliationDomain, ReconciliationSweepItem[]> = {
    PAYMENTS: toSweepItems(await paymentBridge.listPaymentReconciliations({})),
    TAX: toSweepItems(await taxBridge.listTaxReconciliations({})),
    FULFILMENT: toSweepItems(await fulfilmentBridge.listFulfilmentReconciliations({})),
    INVENTORY: toSweepItems(await inventoryBridge.listInventoryReconciliations({})),
    ERP: toSweepItems(await erp.listErpReconciliations({})),
  }

  for (const domain of Object.keys(sweeps) as ReconciliationDomain[]) {
    const items = sweeps[domain]
    if (items.length === 0) throw new Error(`Expected at least one ${domain} reconciliation record`)
    const summary = summarizeReconciliationSweep(domain, items, metrics)
    if (summary.actionRequired)
      throw new Error(
        `${domain} reconciliation sweep is action-required: ${summary.slaBreached} record(s) exceeded the ${RECONCILIATION_SLO_MINUTES[domain]}-minute SLO`,
      )
  }

  container.resolve("logger").info(
    `Verified Gate 20 reconciliation sweep across all five domains: ${Object.entries(sweeps)
      .map(([domain, items]) => `${domain}=${items.length}`)
      .join(", ")}`,
  )
}
