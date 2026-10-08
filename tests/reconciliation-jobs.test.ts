import { describe, expect, it } from "vitest"
import { TradeMetrics } from "../src/baobab/observability"
import { summarizeReconciliationSweep } from "../src/baobab/observability/reconciliation-jobs"

describe("Gate 20 reconciliation sweep", () => {
  it("counts matched/variance/pending and never flags a fresh (low-age) non-matched item", () => {
    const summary = summarizeReconciliationSweep("PAYMENTS", [
      { status: "MATCHED", ageMinutes: 500 },
      { status: "VARIANCE", ageMinutes: 1 },
      { status: "PENDING_ERP", ageMinutes: 1 },
    ])
    expect(summary).toMatchObject({
      domain: "PAYMENTS",
      total: 3,
      matched: 1,
      variance: 1,
      pending: 1,
      slaBreached: 0,
      actionRequired: false,
    })
  })

  it("treats RESOLVED the same as MATCHED — a resolved variance is no longer actionable", () => {
    const summary = summarizeReconciliationSweep("TAX", [
      { status: "RESOLVED", ageMinutes: 10_000 },
    ])
    expect(summary).toMatchObject({ matched: 1, variance: 0, pending: 0, actionRequired: false })
  })

  it("flags actionRequired once a non-matched item outlives its domain's SLO", () => {
    const summary = summarizeReconciliationSweep("PAYMENTS", [
      { status: "VARIANCE", ageMinutes: 31 },
    ])
    expect(summary.slaBreached).toBe(1)
    expect(summary.actionRequired).toBe(true)
  })

  it("applies each domain's own SLO target, not a shared default", () => {
    // 90 minutes breaches PAYMENTS' 30-minute target but not TAX's 240-minute target.
    expect(
      summarizeReconciliationSweep("PAYMENTS", [{ status: "PENDING_ERP", ageMinutes: 90 }]),
    ).toMatchObject({ actionRequired: true })
    expect(
      summarizeReconciliationSweep("TAX", [{ status: "PENDING_ERP", ageMinutes: 90 }]),
    ).toMatchObject({ actionRequired: false })
  })

  it("emits bounded-cardinality metrics per domain and outcome, never per record id", () => {
    const metrics = new TradeMetrics()
    summarizeReconciliationSweep("FULFILMENT", [{ status: "VARIANCE", ageMinutes: 200 }], metrics)
    expect(metrics.snapshot()).toEqual(
      expect.arrayContaining([
        { key: "reconciliation_variance_total|domain=FULFILMENT,outcome=VARIANCE", value: 1 },
        { key: "reconciliation_sla_breach_total|domain=FULFILMENT,outcome=VARIANCE", value: 1 },
      ]),
    )
  })
})
