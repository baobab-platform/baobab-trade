# ADR-0015 — Payment orchestration audit (2026-11-09)

**Normative basis:** Accepted ADR-0015, PAY-COM-008–019, 025–033, §§180–181.

**Defect:** `MedusaPaymentOrchestrationAdapter.initiate` protected only **cross-digital-estate** idempotency-key reuse. Within one estate, an identical key could return a different buyer's payment, a different legal seller or merchant, or a modified amount/terms. `PaymentBridgeRecordAdapter.create` can adopt an existing row after its key lock / constraint race, without the orchestration port verifying the returned outcome. Transition replay checked from/to statuses but not the original `payment_id`, allowing a cross-payment transition key to appear valid.

**Delivered:** Check all immutable payment request facts (estate, buyer, order, seller, Market, merchant/provider, method, terms, currency, amount, payment reference, key and due date) on both initial replay and create readback. Correlation ID may change on retry. Reject cross-payment transition idempotency reuse. Keep provider-side unknown financial outcomes distinct from FAILED, and keep provider idempotency/settlement distinct from ERP accounting.

**Not yet qualified:** Live CP attestation of seller–merchant account + currency, PSP/provider sandbox retries after unknown timeout, financial signature/webhook replay, distributed locking under PostgreSQL, partial capture/refund, reconciliation and all §181 connected scenarios. This pure seam is not a provider credential verifier and must not be activated as protected settlement authority. Trade #189 and Payments DEV-15 real IAM/CP mandates remain separate.

**Status: PARTIAL — production/connected acceptance HELD.**


## 27 November 2026 follow-up

- Payment attempts now persist tenant, initiating Principal, buyer party, opaque CP Market ID/revision, Market key, legal seller, provider, merchant account and provider environment. The migration keeps legacy rows nullable but enforces an all-or-none context constraint; the adapter fails closed when required fields are absent.
- Added provider-reference uniqueness scoped by provider, merchant account and environment. The payment idempotency key remains globally unique in the current module, which is stricter than a scoped key and prevents cross-account key reuse rather than allowing ambiguous replay.
- Minor-unit amounts and Market revisions are parsed as exact integer values; the adapter no longer uses an unchecked `Number(...)` conversion.
- Provider-backed state changes, including resolution from `UNKNOWN`, require provider reference and status evidence. Replayed transition records must match the same payment, state pair and provider evidence, and the current payment row must already reflect the recorded target state.
- **Unresolved atomicity blocker:** the transition record insert and Payment state update are still separate module-service writes under a lock, not one PostgreSQL transaction. A crash between them leaves a recorded transition with the old Payment state; the adapter now fails closed and requires reconciliation, but does not repair it. Do not merge or activate until this local transaction boundary is implemented and fault-tested.
- The existing Digital Estate one-party mapping (B2B organisation → ZuriBeans; B2C customer → Thamani) remains the repository's explicit policy from the earlier payment migration; it is not inferred from country or currency.
- No PSP adapter, merchant ownership attestation, provider webhook reconciliation, refund/capture/settlement integration, or live credentials are established. The new schema migration has not yet been executed against PostgreSQL 17. This PR is not production-qualified.
