# ADR-0035 implementation audit — 9 November 2026

**Status:** Accepted by the Platform Owner, subordinate to Accepted ADR-SHARED-042 Decision 9 and CP ADR-BCP-031. This architectural acceptance grants no assignment and activates no native commitment. The CP resolver and typed provenance classification already exist and are tested with synthetic CP responses. Live CP/IAM/assigned-resource evidence remains unqualified.

## Corrective increment

The CP resource-assignment resolver previously accepted HTTPS URL userinfo, query strings and fragments. Such endpoint configurations are ambiguous or potentially credential-bearing. It also forwarded blank workload access tokens to CP as `Bearer ` rather than refusing locally. This PR rejects those URLs and absent/blank Trade workload credentials before any transport call; negative tests confirm the provider is never called without a token.

## HELD

Real IAM client-credentials and server-application evidence, CP ACTIVE assignment/approval records, native configuration digest registration, Market/operation resolution, revocation/replay, independent traces and owner sign-off are not demonstrated. This decision must not be interpreted as seller or buyer authority. Gate activation remains ADR-0036's separate protected operation.

Validation: `npx vitest run tests/estate-resource-assignment.test.ts tests/native-commitment-classification.test.ts`; `npm run typecheck`; `npm run format:check`. Draft pending CI.
