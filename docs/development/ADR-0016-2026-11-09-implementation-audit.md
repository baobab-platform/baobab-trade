# ADR-0016 — Fulfilment/shipping provider audit (2026-11-09)

**Normative basis:** Accepted ADR-0016 FUL-COM-001–030, especially 013–016, 021–027, §§116–117.

**Finding:** `MedusaFulfilmentAdapter.request` prevented only cross-Digital Estate idempotency reuse. The same key could adopt a different buyer, legal seller, warehouse/source location, logistics provider or physical shipment details. A bridge create under the distributed lock could also return an unrelated row. In `FulfilmentBridgeRecordAdapter.transition` the duplicate transition check compared `prior.from_status` to the **current** status after success; this invalidly refuses legitimate committed-result-loss replay.

**Implementation:** Explicit immutable fulfilment intent checking on both lookup and create readback; exact cross-border metadata and item/warehouse/carrier binding; finite weight and safe package-count validation; bounded idempotency key. Replay now checks its recorded original `from` and `to` against the original request and confirms the persisted native target state; cross-fulfilment transition keys are refused.

**Outstanding:** Live CP seller/tenant/location and carrier binding; provider sandbox dispatch/tracking; native inventory reservation/fulfilment consistency; cancellation-after-dispatch, returns inspection before restock, customer shipping vs carrier cost, async provider inbox replay/unknown outcome and ADR §117 connected cases. No claim this seam can call a provider safely without real IAM/CP credentials. No physical shipment success is simulated as real.

**Disposition:** Development source guard only, production integration HELD.