# ADR-0033 implementation audit — 9 November 2026

**Architecture:** Accepted pursuant to the Platform Owner directive. ADR-SHARED-042 and later accepted owner decisions still control. Buyer-context evaluation exists, with IAM BFF/human token verification, approved assurance, CP Principal and estate binding, Trade relationship/roles, CP Organisation/Market attestation and bounded evidence lifetime. Source-only proofs do not qualify the connected IAM/CP system.

## Corrective increment

The post-CP recheck previously verified only relationship/membership IDs, statuses and revisions. These revisions are supposed to change whenever authoritative fields change, but a migration/projection defect or corrupt row could retain the revision and alter the binding/provenance. The post-CP check now explicitly rechecks the seller-side tenant, canonical Organisation, Trade engine instance, relationship link provenance, membership Principal and membership Organisation. Regression mutates provenance during CP I/O without a revision bump and requires a generic refusal; no detail about the unrelated Organisation may leak.

## Remaining HELD

Current role/state must be read from native authority; the result is a short-lived decision context, never standalone checkout approval. CAA-06 native spend reservation and buyer/seller authority composition, actual CP/IAM credentials, concurrent native revision locks, independently exported trace and staging acceptance remain unqualified. Existing legacy Medusa customer session remains an explicit compatibility path; no new fallback.

Test: `npx vitest run tests/buyer-authority.test.ts`; `npm run typecheck`; `npm run format:check`. PR draft, no merge until CI and owner verification.
