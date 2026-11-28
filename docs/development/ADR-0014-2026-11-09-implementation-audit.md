# ADR-0014 — Order commitment audit (2026-11-09)

**Accepted architecture:** ADR-0014 §§145–150, 163–167; ORD-COM-001–033.

**Finding:** `MedusaOrderOrchestrationAdapter.place` previously returned any order matching a bare idempotency key without checking buyer, Market, seller, currency, price or order reference. This may return an unrelated order for a reused key and silently adopt changed financial facts. The create adapter similarly trusted a returned snapshot. The small internal seam performs an unsafe read-before-create operation that **does not** prove atomic native checkout.

**Implemented:** validate the bounded command identity and exact amount/currency; compare every immutable purchase context field on read replay and on create readback; allow correlation-ID changes between retries; refuse conflicting replays without disclosing the foreign order. Added adversarial tests and retained existing positive readback tests.

**Unqualified critical work:** This check cannot guarantee concurrent idempotency because `findByIdempotencyKey` and `create` are separate. Trade #189 must prove a native Medusa 2.21 non-draft order, legal-seller and buyer spend commitments, and outbox event **in one PostgreSQL transaction** under the same transaction ID, including crash-after-commit, committed-result loss/re-adoption, ERP inbox replay and refusal of synthetic buyer origin. It must confirm the authoritative price/inventory/CP seller/buyer facts at commit. No distributed ACID transactions. ADR-0014 §164 complete connected cases remain HELD.

**Disposition:** Internal adapter development hardening only; full checkout acceptance not established.


## 27 November 2026 follow-up

- The replay guard now binds tenant, buyer Principal, buyer organisation, opaque CP Market ID and revision, canonical Market key, legal seller, currency, order reference, total and idempotency key. Correlation ID may change across a retry.
- The repository lookup contract now requires a tenant/Principal/organisation scope instead of a bare global key. The durable database uniqueness constraint and transactional commit remain unimplemented in this adapter.
- Native Order IDs are checked, and retrieval refuses a repository result whose ID differs from the requested ID.
- This remains a pure source guard: no production repository implementation, native Medusa transaction, full line/tax/shipping snapshot, buyer authority resolution, or same-transaction outbox is established. PR #189 remains the connected buyer-origin acceptance path; no §164 completion or production activation is claimed.
