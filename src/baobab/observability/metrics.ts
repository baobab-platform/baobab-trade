export const TRADE_METRICS = [
  "http_requests_total",
  "http_request_duration_ms",
  "outbox_pending",
  "outbox_retry_total",
  "outbox_dead_letter",
  "integration_reconciliation_required",
  "dependency_health",
  "reconciliation_variance_total",
  "reconciliation_sla_breach_total",
] as const
export type TradeMetric = (typeof TRADE_METRICS)[number]
/**
 * `domain` is bounded to `ReconciliationDomain` (`./reconciliation-jobs.ts`)
 * by convention, same as every other label here — none of these fields is
 * type-enforced to its closed set, matching the existing `outcome`/`market`
 * fields, so a caller stays responsible for never passing an unbounded
 * value (a customer/order/tenant id) as a label.
 */
type Labels = { market?: string; outcome?: string; dependency?: string; domain?: string }
const labelsKey = (labels: Labels) =>
  Object.entries(labels)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join(",")
export class TradeMetrics {
  private readonly values = new Map<string, number>()
  increment(metric: TradeMetric, labels: Labels = {}, value = 1) {
    const key = `${metric}|${labelsKey(labels)}`
    this.values.set(key, (this.values.get(key) ?? 0) + value)
  }
  gauge(metric: TradeMetric, value: number, labels: Labels = {}) {
    this.values.set(`${metric}|${labelsKey(labels)}`, value)
  }
  snapshot() {
    return [...this.values.entries()].map(([key, value]) => ({ key, value }))
  }
}
