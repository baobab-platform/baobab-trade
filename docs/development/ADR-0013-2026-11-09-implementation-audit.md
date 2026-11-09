# ADR-0013 — Inventory / ERP stock boundary audit (2026-11-09)

**Governing ADR:** Accepted ADR-0013, §§4–19, 78, 88, 117, 137–138; INV-COM-001–030.

**Source finding:** `MedusaInventoryAvailabilityAdapter.getAvailability` accepted the complete native level payload without rechecking returned item/location ownership, duplicate levels, malformed stock values, or whether an explicit location filter was empty. Requests with malformed reservation identities also reached native effects. `reconcileInventory` and `assertProjectionSequence` permitted unsafe integer precision.

**Implementation:** source-side fail-closed returned-row identity and location checks, no ambiguous duplicate levels, exact nonnegative safe-integer quantities, unique/explicit location filters, verified reservation inputs and safe sequence/reconciliation values. **Medusa's own `available_quantity` remains authoritative**; do not recalculate using incoming stock or ERP physical on-hand.

**Acceptance gap:** This adapter is an internal Commerce port, **not an IAM/CP tenant/location authorisation check**. It neither provides native transactional reservation idempotency nor establishes live ERP outbox/inbox sequence ordering and replay. ADR-0013 §138 real Medusa/PostgreSQL reservation/crash/release/backorder/safety-stock, ERP divergence, tenant-owned allocation, out-of-order event and physical warehouse reconciliation remain unqualified. No cross-engine database writes, and no search-index or storefront stock authority permitted.

**Status: PARTIAL — production/connected conformance HELD.**