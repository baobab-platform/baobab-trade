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
