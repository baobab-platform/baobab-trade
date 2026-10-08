export type OperationalDiagnostics = {
  generatedAt: string
  outbox: { pending: number; retry: number; deadLetter: number }
  reconciliationRequired: number
  dependencies: Record<string, "UP" | "DOWN" | "DEGRADED">
}
export const assessOperationalStatus = (diagnostics: OperationalDiagnostics) => {
  if (Object.values(diagnostics.dependencies).includes("DOWN") || diagnostics.outbox.deadLetter > 0)
    return "ACTION_REQUIRED" as const
  if (
    Object.values(diagnostics.dependencies).includes("DEGRADED") ||
    diagnostics.outbox.retry > 0 ||
    diagnostics.reconciliationRequired > 0
  )
    return "DEGRADED" as const
  return "HEALTHY" as const
}
/**
 * Gate 20: one alert per reconciliation domain named in the completion
 * plan (payments, stock/inventory, tax, fulfilment, ERP), on top of the
 * Gate 16 generic outbox/dependency alerts. `slaBreach` fires from
 * `summarizeReconciliationSweep`'s `actionRequired` verdict — a domain's
 * own reconciliation-record `observed_at` age exceeding
 * `RECONCILIATION_SLO_MINUTES` (`./reconciliation-jobs.ts`) for that
 * domain, which is a stricter, domain-aware condition than the generic
 * `reconciliationRequired` alert below (any variance at all, one fixed
 * 30-minute window, no domain distinction).
 */
const RECONCILIATION_DOMAIN_ALERTS = {
  paymentReconciliationSlaBreach: "> 0 for 30m (ADR-0015 §152)",
  inventoryReconciliationSlaBreach: "> 0 for 60m (ADR-0013 §126)",
  taxReconciliationSlaBreach: "> 0 for 240m (ADR-0018 §96)",
  fulfilmentReconciliationSlaBreach: "> 0 for 120m (ADR-0016 §90)",
  erpReconciliationSlaBreach: "> 0 for 60m (ADR-0014 §138)",
} as const

const COMMERCE_OPERATIONS_PANELS = [
  "Request rate and errors",
  "Request latency",
  "Outbox backlog and retry",
  "Dead letters",
  "Dependency health",
  "Reconciliation required",
] as const

const COMMERCE_OPERATIONS_ALERTS = {
  deadLetter: "> 0 for 5m",
  outboxBacklog: "increasing for 15m",
  dependencyDown: "> 2m",
  reconciliationRequired: "> 0 for 30m",
  ...RECONCILIATION_DOMAIN_ALERTS,
} as const

export const ZURIBEANS_DASHBOARD = {
  title: "ZuriBeans Commerce Operations",
  panels: COMMERCE_OPERATIONS_PANELS,
  alerts: COMMERCE_OPERATIONS_ALERTS,
} as const

/** Same operational signals as `ZURIBEANS_DASHBOARD`, filtered to Thamani's own Digital Estate for an ops team that only owns B2C. */
export const THAMANI_DASHBOARD = {
  title: "Thamani Commerce Operations",
  panels: COMMERCE_OPERATIONS_PANELS,
  alerts: COMMERCE_OPERATIONS_ALERTS,
} as const
