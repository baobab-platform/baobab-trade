# ADR-0013 — Inventory / ERP stock boundary audit (2026-11-09)

**Governing ADR:** Accepted ADR-0013, §§4–19, 78, 88, 117, 137–138; INV-COM-001–030.

**Source finding:** `MedusaInventoryAvailabilityAdapter.getAvailability` accepted the complete native level payload without rechecking returned item/location ownership, duplicate levels, malformed stock values, or whether an explicit location filter was empty. Requests with malformed reservation identities also reached native effects. `reconcileInventory` and `assertProjectionSequence` permitted unsafe integer precision.

**Implementation:** source-side fail-closed returned-row identity and location checks, no ambiguous duplicate levels, exact nonnegative decimal quantities, unique location filters and safe projection sequence values. **Medusa's own `available_quantity` remains authoritative**; do not recalculate using incoming stock or ERP physical on-hand.

**Acceptance gap:** This adapter is an internal Commerce port, **not an IAM/CP tenant/location authorisation check**. It neither provides native transactional reservation idempotency nor establishes live ERP outbox/inbox sequence ordering and replay. ADR-0013 §138 real Medusa/PostgreSQL reservation/crash/release/backorder/safety-stock, ERP divergence, tenant-owned allocation, out-of-order event and physical warehouse reconciliation remain unqualified. No cross-engine database writes, and no search-index or storefront stock authority permitted.

**Status: PARTIAL — production/connected conformance HELD.**

## 27 November 2026 follow-up

- Repository Medusa baseline is `@medusajs/medusa` / `@medusajs/framework` 2.21.2. Its native cart inventory-confirmation step uses `BigNumberInput` and `MathBN.mult(item.quantity, item.required_quantity)`; inventory-item quantities therefore cannot be restricted to safe integers. The read adapter and reconciliation now preserve exact decimal quantities as strings using Medusa `MathBN`.
- The adapter returns Medusa's own `available_quantity`; it no longer derives an ATS value from `stocked_quantity - reserved_quantity`. Reconciliation receives and preserves `medusaAvailable`, reports only the ERP/Medusa stocked delta, and never writes or overwrites stock.
- Removed the custom `reserve`/`release` wrapper. Reservation lifecycle remains in Medusa's native cart/order workflows; Trade does not create a parallel reservation mechanism.
- Medusa's native cart flow applies `required_quantity` and locking during reservation. The current upstream reservation step selects `location_ids[0]`; multi-location allocation is not proven by this PR. Upstream issue #17215 also documents a reservation-location movement defect reproduced on Medusa 2.21.2. Do not claim multi-location reservation correctness until the pinned upstream version is verified/fixed and tested.
- This PR remains a source-level read/reconciliation helper without a production runtime consumer or connected ERP reconciliation. It does not authorize stock writes, order placement or production activation.

The existing bridge persists integer reconciliation columns. Bootstrap callers pass Medusa's own availability and refuse fractional or out-of-range projection writes at that boundary. Native Medusa reservation creation and release remain exercised in the existing verification commands. A fractional ERP projection migration and controlled backorder acceptance require their own connected evidence.
