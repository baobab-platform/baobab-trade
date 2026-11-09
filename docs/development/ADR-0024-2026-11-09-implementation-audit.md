# ADR-0024 implementation audit — 9 November 2026

**Governance:** ADR-0024 is presently Proposed — Normative Trade Architecture. This PR is a narrow security correction and does not silently accept the decision.

## Confirmed gap

The Gate ZB-06 assortment policy currently considers ELIGIBLE_WITH_CONDITIONS permissive. A product is therefore included in buyer-facing sellable ids without evidence that the required permit, facility, label, destination, product-lot, importer or documentary conditions were fulfilled. The domain model stores eligibility state but does not carry qualified condition evaluations. A bare conditional label is not a regulatory determination for this transaction.

## Correction

- Fail closed for ELIGIBLE_WITH_CONDITIONS for buyer-facing assortment and direct sellability checks until trusted, transaction-scoped condition resolution is integrated.
- Leave ELIGIBLE as the only permissive classification; all unknown/pending/review/expired/suspended/error states continue to refuse.
- Update Gate ZB-06 policy regression expectations and demonstrate conditional products are blocked by the public assortment partition.
- Do not overlap ADR-0011 PR #204, which separately hardens admin Market eligibility inputs and buyer-facing endpoints.

## HELD

This change does NOT demonstrate live regulatory attestation, explicit origin/lot, product classification version, regulated documents, origin/destination checks, current CP/IAM provider access, provider-signed conditional resolution, customs or shipping compliance. Source-only tests cannot accept the full ADR-0024 definition of done. Related ADR-0021 PR #214 is a distinct provider clearance component.

## Validation

    npx vitest run src/baobab/b2b/product-assortment-policy.test.ts
    npm run typecheck
    npm run format:check

Draft, do not merge until #204 overlap and operational implications are reviewed.
