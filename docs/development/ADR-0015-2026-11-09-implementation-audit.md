# ADR-0015 — Payment orchestration audit (2026-11-09)

**Normative basis:** Accepted ADR-0015, PAY-COM-008–019, 025–033, §§180–181.

**Defect:** `MedusaPaymentOrchestrationAdapter.initiate` protected only **cross-digital-estate** idempotency-key reuse. Within one estate, an identical key could return a different buyer's payment, a different legal seller or merchant, or a modified amount/terms. `PaymentBridgeRecordAdapter.create` can adopt an existing row after its key lock / constraint race, without the orchestration port verifying the returned outcome. Transition replay checked from/to statuses but not the original `payment_id`, allowing a cross-payment transition key to appear valid.

**Delivered:** Check all immutable payment request facts (estate, buyer, order, seller, Market, merchant/provider, method, terms, currency, amount, payment reference, key and due date) on both initial replay and create readback. Correlation ID may change on retry. Reject cross-payment transition idempotency reuse. Keep provider-side unknown financial outcomes distinct from FAILED, and keep provider idempotency/settlement distinct from ERP accounting.

**Not yet qualified:** Live CP attestation of seller–merchant account + currency, PSP/provider sandbox retries after unknown timeout, financial signature/webhook replay, distributed locking under PostgreSQL, partial capture/refund, reconciliation and all §181 connected scenarios. This pure seam is not a provider credential verifier and must not be activated as protected settlement authority. Trade #189 and Payments DEV-15 real IAM/CP mandates remain separate.

**Status: PARTIAL — production/connected acceptance HELD.**
