# ADR-0023 implementation audit — 9 November 2026

**Architecture status:** Accepted by Platform Owner directive, 9 November 2026, under higher accepted Shared/CP/IAM decisions. The implementation remains a draft and its outstanding runtime qualification gates are HELD; architecture acceptance is not production certification.

## Audited scope

Thamani's existing supplier configuration is explicitly synthetic/reference metadata and has no authority to activate a vendor or pay an invoice. A valid registered supplier or CP canonical identity does not by itself establish Trade relationship approval, product/market qualification, transaction compliance, ERP vendor status or supplier-user IAM access. These are distinct authorities under the proposed federated supplier-master model.

## Corrective security tranche

New internal server-side supplier-readiness gate requires matching tenant, buyer LegalEntity, canonical supplier Organisation, Market and product across independent CP identity/role, Trade active relationship, ERP vendor projection and current compliance receipts. An IAM portal receipt is additionally required for supplier portal operations. Required product qualifications must have one current independently approved evidence reference; waiver, conditions, self-approval and expired qualification cannot silently activate procurement. Tests include sibling-tenant and different-product denial.

There is no new canonical supplier identity, no self-onboarding approval route, no bank change route, and no supplier-created ERP Business Partner. Trusted adapters are mandatory; arbitrary portal-supplied 'attestation' data must never be routed directly into this kernel.

## Held / unqualified

Actual CP Organisation/role attestation, Trade supplier relationships and qualification persistence, evidence custody, credentialed IAM supplier journey, CP engine/Market binding, real ERP iDempiere C_BPartner provisioning and native readback, financial verification, sanctions and product screening, idempotent events and cross-tenant connected tests all remain outstanding.

This tranche is not the complete ADR-0023 Definition of Done and may not be represented as production supplier onboarding.

## Validation

    npx vitest run tests/adr-0023-supplier-readiness.test.ts
    npm run typecheck
    npm run format:check

Keep draft until the ADR status is reconciled and connected acceptance is available. No merge.


## 27 November 2026 follow-up

- Readiness scope now binds tenant, buyer and supplier LegalEntities, Market ID/revision, canonical supplier Organisation, canonical product, supplier product reference, origin/destination and Trade Lane where cross-border.
- Separate owner receipts are required for CP canonical supplier role, Trade relationship, Trade product capability, Trade market eligibility, ERP vendor readiness and compliance clearance; IAM portal access is required only for supplier-portal operations.
- Qualification requirements now arrive as a scope-bound, versioned Trade policy. Each required type must have exactly one current PASSED receipt with evidence, approval reference, Trade decider role/authority, and a different submitter. PASSED_WITH_CONDITIONS, WAIVED and all other non-PASSED states remain non-ready.
- The returned readiness snapshot preserves the policy reference/version, owner authority/reference/version/effective window and qualification approval/evidence references.
- **Authority and release blockers remain:** owner receipts and the qualification policy are still caller-supplied and not authenticated against CP, Trade, ERP, Compliance or IAM. The readiness snapshot is not persisted or signed. Supplier registration/onboarding, supplier organisation projection, duplicate resolution, bank-change maker-checker, ERP C_BPartner provisioning/readback, IAM provisioning, sanctions/product screening, event idempotency/reconciliation and PostgreSQL 17 connected tests remain unimplemented.
