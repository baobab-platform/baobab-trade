# ADR-0019 — Supplier commercial workflow / ERP authority audit (2026-11-09)

**Source:** Accepted ADR-0019 §§3–5, 31–35, 93–104, 122–123 and 130–150. Trade owns supplier RFQ, quote and award; **iDempiere owns Purchase Orders, receipts, invoices, AP and GL**.

**Findings:** Trade has an ERP integration bridge but no complete supplier RFQ→award→native ERP PO chain. Treating an approved award as a purchase order would cause false supplier commitments. Reliable ERP command/outbox/idempotent re-adoption is not yet connected.

**Implemented tranche:** Pure provider-neutral ERP PO acknowledgement validator for an approved award. Requires same tenant, supplier, legal buyer, commitment, approved award, currency, exact safe-integer amount and idempotency key in ERP-sourced evidence; demands native ERP PO ID before `ERP_CONFIRMED`. Missing, unknown or rejected ERP outcome remains `ERP_PENDING` or `ERP_RECONCILIATION_REQUIRED`. Conflicting historical PO identity refused, replay idempotent. Adversarial tests cover cross-entity and fake success.

**Required connected gates:** Trade supplier IAM/KYB and sourcing/quotation/award authority; durable PostgreSQL award/outbox command with exact CP mappings; real ERP inbox and native `C_Order` business partner/warehouse/approved purchase order readback; crash-after-commit/duplicate command, partial receipt, AP match, supplier portal isolation and all ADR §§133–140 scenarios. No cross-engine transaction and no vendor master duplication.

**Status:** PARTIAL, connected production conformance HELD. This module is a consumer guard, not a completed ERP PO adapter.


## 27 November 2026 follow-up

- ERP PO evidence matching now binds tenant, procurement commitment, approved award, canonical supplier, supplier LegalEntity and registration reference, buyer LegalEntity, CP Market ID/revision, currency, exact committed minor amount and idempotency key.
- Award and ERP evidence identifiers are bounded; currency must be uppercase ISO-style alpha-3; Market revision and minor-unit totals must be exact safe integers.
- A CREATED/APPROVED ERP event can establish that a native ERP PO exists only when a native PO identifier is present. It does not itself establish supplier acceptance, goods receipt, invoice liability or payment.
- Unknown/rejected evidence remains reconciliation-required. A prior reconciliation-required projection is not downgraded to pending, and a previously observed native PO ID cannot be replaced by a different PO ID.
- **Connected acceptance remains outstanding:** this helper consumes caller-supplied ERP evidence; it does not authenticate the ERP event, create the ERP PO, persist the projection, prove procurement approval provenance, or qualify an iDempiere integration. PostgreSQL 17 persistence/readback and duplicate/replay tests remain required.
