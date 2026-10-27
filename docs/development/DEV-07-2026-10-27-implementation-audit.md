# DEV-07 — 27 October 2026 source-conformance and next implementation slice

**Authority:** Accepted Shared EA-DEV DEV-07/INT-05, ADR-SHARED-042/043, Trade ADR-0011/0024/0030 and `docs/development/DEV-07.md`.

DEV-07 is an architecture workstream, not a GitHub repository. Its governing register is in `baobab-platform/shared`, and its Medusa B2B implementation lives in `baobab-platform/baobab-trade`.

Trade #172 and Shared #391 merged a bounded native PostgreSQL/Medusa component qualification. The independently verified final receipt is 16 PASS, 9 BLOCKED, zero failed observations. Its evidence is historical and must not be overwritten or promoted. It does **not** certify real IAM/CP buyer identity, network/BFF joins, full INT-05, provider activation, protected staging or production.

## Native buyer-context source gap

The legacy Medusa-customer `GET /store/b2b/context` and its local resolver must not turn an expired/future membership, inactive buyer organisation, ambiguous membership or unknown role into usable context. This is a **read-path fail-closed guard**, not CP Principal resolution or purchasing permission. The canonical BFF path is `POST /store/b2b/buyer-context` and still needs connected IAM-issued and CP-readback evidence. Changes to the legacy route must not weaken that separation.

## Required regression evidence

- Active membership with inclusive start and exclusive end; future, expired, reversed or malformed windows deny.
- Multiple memberships, missing Principal/customer or mismatched owner deny; unknown role grants nothing.
- Suspended organisation denies even if membership is active; active organisation with active membership remains available in the legacy development path.
- Evaluation time is injected into the legacy membership resolver for deterministic source tests. Production still evaluates the current clock after the membership lookup; no earlier request-time authority snapshot is used.
- Exact start-inclusive/end-exclusive millisecond boundaries are exercised, and malformed native membership responses keyed to the wrong customer or Organisation are independently refused before any role read.
- Full repository TypeScript, lint, formatting, unit and PostgreSQL-backed CI must pass at the final reviewed head. Source tests are not independent IAM/CP join evidence.

## Outstanding joined INT-05 obligations — all BLOCKED until proven

1. Real IAM/CP buyer Principal/Organisation/Market authority.
2. Independent supplier/ERP onboarding.
3. Entitled private catalogue and pricing.
4. Canonical RFQ and governed approvals.
5. Quotation lifecycle.
6. Composed native order receipt, spend reservation and replay/commit fence.
7. Actual ERP step.
8. Shipment/documentary access.
9. Cross-jurisdiction seller authority.

Do not promote provider declarations or enable the SHADOW commitment fence by documentation. Preserve the 25 original observation labels and immutable historical evidence. The owner runbook `docs/development/DEV-07.md` remains the source for the disposable native test command and custody constraints.

## Rollback

Revert this bounded legacy-read hardening if a reviewed compatibility fault is demonstrated. Do not revert to allowing out-of-effect buyer identity in protected commerce; disable the legacy route pending correction. There are no schema or fixture migrations in this increment.
