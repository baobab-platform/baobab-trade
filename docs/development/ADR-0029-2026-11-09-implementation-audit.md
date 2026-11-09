# ADR-0029 implementation audit — 9 November 2026

**Repository governance conflict:** Two different files are numbered ADR-0029 and both read Accepted:
- ADR-0029 — Real-Token Integration Verification for Buyer Trade Authorization (ZB-03.7);
- ADR-0029_ ERP Commercial Profile Consumption and Buyer Activation (ZB-04).

These are distinct decisions, not two revisions of one decision. This PR addresses the concrete ZB-04 ERP consumer and preserves the existing ZB-03.7 signed-JWT middleware regression unchanged. Renumbering or superseding requires explicit architecture governance.

## Audited behaviour

The ERP event consumer verifies an HMAC and ERP source, checks tenant, lifecycle and credits, and writes projection and activation receipts. However a correctly signed event with as_of far in the future could activate a buyer now, despite no presently effective ERP attestation. The source parser rejected malformed dates but did not bound future observations.

## Corrective increment

Reject profile as_of more than five minutes ahead of the server clock before any persistence, activation or outbox work. Add regression demonstrating a validly signed future ERP event is denied with no side effects. Existing signed-JWT tests for ZB-03.7 remain applicable and require no production middleware replacement.

## HELD

This does not qualify real IAM token issuance, actual ERP signed event provenance, posted credit/limit ownership, CP LegalEntity mapping, concurrent exactly-once projection and durable inbox/outbox crash replay. Existing compensating deletes cannot prove atomic distributed effects. These remain ADR-0029 ZB-03.10/ZB-04 connected obligations.

Validation:

    npx vitest run tests/buyer-commercial-profile-consumer.test.ts tests/authenticate-middleware.test.ts
    npm run typecheck
    npm run format:check

Draft; no merge pending CI and design review.
