# ADR-0016 — Fulfilment/shipping provider audit (2026-11-09)

**Normative basis:** Accepted ADR-0016 FUL-COM-001–030, especially 013–016, 021–027, §§116–117.

**Finding:** `MedusaFulfilmentAdapter.request` prevented only cross-Digital Estate idempotency reuse. The same key could adopt a different buyer, legal seller, warehouse/source location, logistics provider or physical shipment details. A bridge create under the distributed lock could also return an unrelated row. In `FulfilmentBridgeRecordAdapter.transition` the duplicate transition check compared `prior.from_status` to the **current** status after success; this invalidly refuses legitimate committed-result-loss replay.

**Implementation:** Explicit immutable fulfilment intent checking on both lookup and create readback; exact cross-border metadata and item/warehouse/carrier binding; finite weight and safe package-count validation; bounded idempotency key. Replay now checks its recorded original `from` and `to` against the original request and confirms the persisted native target state; cross-fulfilment transition keys are refused.

**Outstanding:** Live CP seller/tenant/location and carrier binding; provider sandbox dispatch/tracking; native inventory reservation/fulfilment consistency; cancellation-after-dispatch, returns inspection before restock, customer shipping vs carrier cost, async provider inbox replay/unknown outcome and ADR §117 connected cases. No claim this seam can call a provider safely without real IAM/CP credentials. No physical shipment success is simulated as real.

**Disposition:** Development source guard only, production integration HELD.


## 27 November 2026 follow-up

- Fulfilment intent now binds tenant, initiating Principal, opaque CP Market ID/revision, Market key, buyer party, legal seller, source location, logistics provider and cross-border shipment metadata. The migration keeps legacy rows nullable, enforces an all-or-none authority context, and the adapter fails closed on missing legacy context.
- Request validation now checks canonical Market identity/key shape, ISO alpha-2 origin/destination, positive weight/package count, bounded trade references, unique HS references, valid Incoterm/mode and complete cross-border metadata.
- Dispatch and delivery transitions now require a declared authoritative source system and source-event reference. Dispatch also requires shipment reference/date; delivery requires delivery date and shipment continuity, cannot predate dispatch, and tracking URLs must be credential-free HTTPS.
- Transition replay now compares the exact physical evidence, not only the status pair. A prior transition log whose native Fulfilment row has not reached the target state is surfaced as reconciliation-required; it is not reported as success.
- **Unresolved atomicity blocker:** transition-log insertion and native Fulfilment state update remain separate writes under a lock. A crash between them is detected but not repaired. Implement one PostgreSQL transaction and fault-test rollback/replay before merge.
- Evidence source labels and event references are assertions carried by the caller, not authenticated carrier/WMS/ERP proof. No connected carrier, 3PL, WMS or ERP adapter, provider booking, multi-leg orchestration, customs clearance or independent delivery readback is established.
- The new migration has not yet been executed against PostgreSQL 17. No source-level result authorizes staging/production activation or claims provider execution success.
