import { describe, expect, it } from "vitest"
import { createStructuredLogger } from "../src/baobab/logging/logger"
import {
  TradeMetrics,
  assessOperationalStatus,
  parseTraceContext,
  THAMANI_DASHBOARD,
  traceHeaders,
  ZURIBEANS_DASHBOARD,
} from "../src/baobab/observability"
describe("Gate 16 observability", () => {
  it("records bounded-cardinality operational metrics", () => {
    const metrics = new TradeMetrics()
    metrics.increment("outbox_retry_total", {
      market: "zuribeans_ug",
      outcome: "broker_unavailable",
    })
    expect(metrics.snapshot()).toEqual([
      { key: "outbox_retry_total|market=zuribeans_ug,outcome=broker_unavailable", value: 1 },
    ])
  })
  it("parses and forwards W3C trace and correlation context", () => {
    const value = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    const trace = parseTraceContext(value, "corr-16")
    expect(traceHeaders(trace)).toEqual({ traceparent: value, "x-correlation-id": "corr-16" })
  })
  it("rejects malformed tracing", () =>
    expect(() => parseTraceContext("00-bad", "corr")).toThrow(/INVALID/))
  it("raises action-required diagnostics for dead letters", () =>
    expect(
      assessOperationalStatus({
        generatedAt: new Date().toISOString(),
        outbox: { pending: 0, retry: 0, deadLetter: 1 },
        reconciliationRequired: 0,
        dependencies: { postgres: "UP", redis: "UP" },
      }),
    ).toBe("ACTION_REQUIRED"))
  it("defines dashboards and alerts for critical paths", () =>
    expect(ZURIBEANS_DASHBOARD.panels).toContain("Dead letters"))
  it("gives Thamani its own dashboard with a reconciliation SLA-breach alert per Gate 20 domain", () => {
    expect(THAMANI_DASHBOARD.title).toBe("Thamani Commerce Operations")
    expect(THAMANI_DASHBOARD.alerts).toMatchObject({
      paymentReconciliationSlaBreach: expect.stringContaining("30m"),
      inventoryReconciliationSlaBreach: expect.stringContaining("60m"),
      taxReconciliationSlaBreach: expect.stringContaining("240m"),
      fulfilmentReconciliationSlaBreach: expect.stringContaining("120m"),
      erpReconciliationSlaBreach: expect.stringContaining("60m"),
    })
    expect(ZURIBEANS_DASHBOARD.alerts).toEqual(THAMANI_DASHBOARD.alerts)
  })
  it("redacts secrets from structured diagnostic metadata", () => {
    const lines: string[] = []
    const original = console.log
    console.log = (line) => lines.push(String(line))
    try {
      createStructuredLogger("trade").info("request", {
        correlation_id: "corr",
        nested: { access_token: "do-not-log" },
      })
    } finally {
      console.log = original
    }
    expect(lines[0]).not.toContain("do-not-log")
    expect(lines[0]).toContain("[REDACTED]")
  })
  it("redacts consumer PII, not just credentials, from structured log metadata", () => {
    const lines: string[] = []
    const original = console.log
    console.log = (line) => lines.push(String(line))
    try {
      createStructuredLogger("trade").info("registration", {
        correlation_id: "corr",
        customer: { email: "consumer@example.com", phone: "+256700000000" },
      })
    } finally {
      console.log = original
    }
    expect(lines[0]).not.toContain("consumer@example.com")
    expect(lines[0]).not.toContain("+256700000000")
    expect(lines[0]).toContain("[REDACTED]")
  })
})
