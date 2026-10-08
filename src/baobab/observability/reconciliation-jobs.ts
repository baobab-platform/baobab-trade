import type { TradeMetrics } from "./metrics"

/**
 * The five domains Gate 20 names explicitly ("reconciliation jobs for
 * payments, stock, tax, fulfilment and ERP"). Each already has its own pure
 * reconciliation function (`payments/reconciliation.ts`,
 * `inventory/reconciliation.ts`, `tax/reconciliation.ts`,
 * `fulfilment/reconciliation.ts`, `erp-integration/projection.ts`'s
 * `reconcileErpProjection`) and its own persisted `*_reconciliation` table
 * with a `status`/`observed_at`/`resolved_at` lifecycle — this module adds
 * the one thing none of them had: a domain-agnostic sweep over a batch of
 * those outcomes that classifies which ones are actually overdue.
 */
export type ReconciliationDomain = "PAYMENTS" | "INVENTORY" | "TAX" | "FULFILMENT" | "ERP"

/** The five reconciliation modules' own `status` unions, plus `RESOLVED` — every `*_reconciliation` table's status enum already includes it, even though nothing sets it yet. */
export type ReconciliationOutcomeStatus =
  | "MATCHED"
  | "RESOLVED"
  | "VARIANCE"
  | "PENDING_ERP"
  | "PENDING_EXECUTION"

const nonActionableStatuses: ReadonlySet<ReconciliationOutcomeStatus> = new Set([
  "MATCHED",
  "RESOLVED",
])

export type ReconciliationSweepItem = {
  status: ReconciliationOutcomeStatus
  ageMinutes: number
}

/**
 * Target time-to-resolution for a non-`MATCHED`/`RESOLVED` outcome, per
 * domain. ADR-0013 §126, ADR-0014 §138, ADR-0015 §152, ADR-0016 §90 and
 * ADR-0018 §96 each require a domain reconciliation SLO but none names a
 * number — these are starting targets `docs/operations/observability.md`
 * (whose deployment platform owns alert routing) is expected to tune.
 */
export const RECONCILIATION_SLO_MINUTES: Record<ReconciliationDomain, number> = {
  PAYMENTS: 30,
  INVENTORY: 60,
  TAX: 240,
  FULFILMENT: 120,
  ERP: 60,
}

export type ReconciliationSweepSummary = {
  domain: ReconciliationDomain
  total: number
  matched: number
  variance: number
  pending: number
  slaBreached: number
  actionRequired: boolean
}

/**
 * The reconciliation "job" itself: one batch sweep over a domain's current
 * reconciliation outcomes. This repository owns the sweep logic and the
 * metric/label names it emits; the deployment platform owns scheduling it
 * on a cadence and routing `actionRequired` to an alert
 * (`docs/operations/observability.md`). Fails open on classification (an
 * item is only ever counted, never thrown on) but is fail-closed on the
 * verdict: a single SLO breach flips the whole sweep `actionRequired`,
 * matching `assessOperationalStatus`'s existing style.
 */
export const summarizeReconciliationSweep = (
  domain: ReconciliationDomain,
  items: readonly ReconciliationSweepItem[],
  metrics?: TradeMetrics,
): ReconciliationSweepSummary => {
  const sloMinutes = RECONCILIATION_SLO_MINUTES[domain]
  let matched = 0
  let variance = 0
  let pending = 0
  let slaBreached = 0

  for (const item of items) {
    if (nonActionableStatuses.has(item.status)) {
      matched += 1
      continue
    }
    if (item.status === "VARIANCE") variance += 1
    else pending += 1
    metrics?.increment("reconciliation_variance_total", { domain, outcome: item.status })
    if (item.ageMinutes > sloMinutes) {
      slaBreached += 1
      metrics?.increment("reconciliation_sla_breach_total", { domain, outcome: item.status })
    }
  }

  return {
    domain,
    total: items.length,
    matched,
    variance,
    pending,
    slaBreached,
    actionRequired: slaBreached > 0,
  }
}
