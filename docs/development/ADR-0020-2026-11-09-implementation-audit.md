# ADR-0020 implementation audit — 9 November 2026

Authority: accepted **ADR-0020 — B2B Landed Cost, Margin and Commercial Price Resolution Model**. This is a bounded Trade-side implementation; it does not revise the ADR or certify the full release.

## Audited baseline and corrective increment

Main has a Medusa-native price candidate decision port and a separate DEV-07 RFQ/quotation lifecycle. Neither establishes a trusted ERP commercial cost-basis or exact margin-floor evaluation. The RFQ quotation input can carry quoted money but is expressly not a final checkout valuation. Open ADR-0012 PR #205 independently hardens the Medusa price list/candidate scope; this increment does **not** edit its files or depend on its unmerged branch.

Added an internal, provider-neutral, side-effect-free cost/price resolution module at src/baobab/pricing/commercial-cost-resolution.ts with adversarial unit tests. It:

- Accepts only exact decimal-string minor units and computes markup versus gross margin using BigInt with ceiling rounding, not floating-point;
- Requires matching canonical tenant, seller LegalEntity, Market, product and currency scopes for cost evidence and margin policy; optional buyer-scoped policy must match the selected buyer;
- Distinguishes ERP-actual and governed estimated/replacement costs, explicitly retaining source, version, observed time and expiry;
- Refuses absent/stale/future-dated cost evidence and expired/unapproved policy windows rather than assuming zero cost or current FX;
- Preserves a deterministic, fingerprinted price snapshot including cost basis, policy and chosen customer price;
- Blocks hard-floor violations; soft-floor violations return REQUIRES_APPROVAL and cannot be treated as authorised to commit;
- Separately computes realised and expected margin variance from later ERP actual cost without overwriting the historic quote.

**Critical security contract:** The kernel receives already resolved inputs from trusted server-side ports. It is not a privileged IAM/CP PEP; callers MUST NOT map browser-supplied context, policy, "ERP" labels or cost evidence directly into it. A digest is change detection, not an independent ERP signature or authorization token. There is no public endpoint, automatic Medusa hook, accounting mutation or event publication in this increment.

## Remaining ADR-0020 qualification gaps

**HELD — NOT ADR ACCEPTANCE:**

1. Canonical Shared cost and policy schemas, and current CP capability/seller/Market attestation and IAM permission checks.
2. ERP/iDempiere cost projection provider with independent source provenance, legal-entity resolution, freshness, cost allocation and durable replay.
3. Governed UOM conversion, currency-aware scale (the caller supplies minor units), FX source/rate conversion and cross-border freight/customs evidence. Cross-currency quotes currently refuse.
4. Persisted versioned quote snapshots, current quote validity/approval signatures, customer-contract and volume-price composition with ADR-0012.
5. Atomically fenced native Medusa order and outbox, #189 buyer commitment integration, post-order actual-cost reconciliation and independent exported traces.
6. Connected conformance simulations under ADR sections 130–134 (UG→ZA, ZA→UG, local and intercompany), real ERP readback and isolated multi-tenant negative proofs.

No fabricated cost, tax, courier, customs or FX provider success may count as connected evidence.

## Validation commands

    npx vitest run tests/adr-0020-commercial-cost-resolution.test.ts
    npm run typecheck
    npm run format:check

CI should execute these checks on the actual PR head. No claims of successful connected tests are made by this document.

## Dependency and merge discipline

- ADR-0012: PR #205 — price-list and buyer scope hardening; potential later composition, no overlapping edits.
- ADR-0014: PR #207 and DEV-07 #189 — order commitment boundary remains authoritative.
- ADR-0018: PR #211 — tax provenance; a landed-cost kernel does not determine tax.
- ADR-0019: PR #212 — ERP PO evidence adoption, still an unqualified provider integration.
- Keep this PR draft until review, CI and higher-order authority tests establish release readiness. Do not infer full ADR-0020 completion from the source tests.
