# ADR-0031 implementation audit — 9 November 2026

**Status:** Accepted. Governing ZB-04 buyer invitation delivery and token lifecycle.

## Audited gap

Invitation issuance/rotation stores only a token hash, invitation acceptance validates the authenticated Customer email and distinct canonical Principal, and durable provider attempts are recorded. The acceptance route however only rejected an expiry when it existed and parsed to a past Date. Missing expiry or malformed expiry bypassed that conditional, allowing an unbounded invited bearer token to be redeemed. ADR-0031 requires 48-hour tokens.

## Corrective implementation

Treat missing, malformed, expired and greater-than-48-hour future leases as invalid during authenticated acceptance, before any membership mutation. Tests assert no activation for all four cases. This preserves the existing hash-only storage, single-use token clearing, customer-email binding and notification workflow.

## HELD

No live notification delivery/readback, provider secret custody audit, replay under concurrent multi-process transactions, independent IAM Principal trust proof or connected onboarding certification. This narrower source correction does not prove the complete invitation lifecycle.

Validation:

    npx vitest run tests/buyer-invitation-route.test.ts tests/buyer-invitation-lifecycle.test.ts
    npm run typecheck
    npm run format:check

Draft; no merge until full CI and review.
