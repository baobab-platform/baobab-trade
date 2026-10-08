# Commerce observability

Gate 16 defines one correlated operational view across requests, workflows, outbox publication and reconciliation. Logs, metrics and traces use `correlation_id`; canonical events additionally preserve causation and W3C trace context.

Metrics use bounded labels (`market`, `outcome`, `dependency`, `domain`). Tenant, organisation, order, customer and event IDs are prohibited as metric labels because they create unbounded series. Those identifiers belong in access-controlled structured logs and traces.

The ZuriBeans and Thamani operations dashboards (`ZURIBEANS_DASHBOARD`/`THAMANI_DASHBOARD`, `src/baobab/observability/diagnostics.ts`) cover request rate/errors/latency, outbox backlog/retry/dead letters, dependency health and reconciliation. Alerts require sustained conditions to avoid flapping. A dead letter is always action-required; it is never silently counted as success.

## Gate 20 reconciliation jobs

Each of the five domains named in the completion plan — payments, stock (inventory), tax, fulfilment, ERP — already has its own pure reconciliation function and its own persisted `*_reconciliation` table. `summarizeReconciliationSweep` (`src/baobab/observability/reconciliation-jobs.ts`) is the domain-agnostic sweep over a batch of those outcomes: it classifies each as within or past its domain's `RECONCILIATION_SLO_MINUTES` target and emits `reconciliation_variance_total`/`reconciliation_sla_breach_total`, labelled by the bounded `domain`/`outcome` pair, never a record id. `verify:observability` (`src/scripts/verify-observability.ts`) runs one sweep per domain against whatever reconciliation records the pipeline's earlier Gates created, in CI's `core-module-integration` job — this is what a scheduled run of the same sweep would do on every firing; this repository owns the sweep logic and metric names, not the schedule that triggers it.

Operational diagnostics contain status and counts, not secrets, PII, payload bodies or database details. The deployment platform owns collectors, retention, alert routing, dashboard provisioning and reconciliation-sweep scheduling; this repository owns instrumentation names, diagnostic semantics and the sweep/SLO logic itself.

See `docs/operations/runbooks/` for the operational runbooks a domain's alert should link to (payments today, per ADR-0015 §153's explicit list).
