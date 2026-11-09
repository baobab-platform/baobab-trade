# ADR-0034 implementation audit — 9 November 2026

**Architecture status:** Accepted by the Platform Owner; subordinate to Accepted ADR-SHARED-042. Database classification, CP profile observations and native commitment fence already exist under a SHADOW enforcement gate. This incremental PR does not enable the gate.

## Audited gap

The classification kernel matched buyer estate, Tenant, engine and estate-binding provenance but did not require the buyer execution context's `market_id` to match the seller attribution's canonical CP Market. The buyer context schema permits an absent market when no country selection was requested; such a buyer should not classify a binding native purchase against a Market it never selected.

## Correction

Require `TradeBuyerExecutionContext.market_id` to equal the native commitment's CP Market. Absence or cross-Market selection is a `CLASSIFICATION_CONFLICT`; there is no B2C fallback. Unit regression confirms no classification is written. Native PostgreSQL classification and Trade-A commit-fence regression fixture contexts now carry their explicitly selected synthetic Market.

## Held

Real CP profile/Market attestation, current buyer IAM/CP role and budget, atomic buyer spend reservation and independent native order/commit/outbox evidence remain unqualified. Enablement of `trade_commit_fence_enforcement` must remain SHADOW until authorized staging evidence and rollback controls exist.

Validation: `npx vitest run tests/native-commitment-classification.test.ts`; `npm run regression:native-commitment-classification` and `npm run regression:trade-a-commit-fences` require a disposable PostgreSQL 17 runtime. This report does not claim those connected checks passed.
