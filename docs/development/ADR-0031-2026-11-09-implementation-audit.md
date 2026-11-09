# ADR-0031 — 9 November 2026 implementation audit

**Decision:** Accepted, buyer invitation delivery and token lifecycle (ZB-04).

The current invitation acceptance handler enforces an authenticated customer, mapped canonical Principal, normalised invitation-email match, membership status and organisation status. Audit found that it treated a missing, invalid or expired `invitation_expires_at` as usable because expiry was checked only when truthy, and invalid Date comparisons are always false. This breaks ADR-0031's 48-hour single-use constraint for a corrupted or incomplete row.

This PR refuses missing, unparseable and elapsed expiry, before any membership activation. A new regression exercises malformed, missing and expired dates and demands no membership update.

**Outstanding:** full atomic claim/consume under concurrent requests, expiration enforced in native SQL, provider delivery proof (actual email) and IAM-issued Principal mapping readback, timeout/race/replay evidence. A successful isolated route test is not ZB-04 environment certification. No new API exposes raw bearer tokens.

Validation: `npx vitest run tests/buyer-invitation-route.test.ts tests/buyer-invitation-lifecycle.test.ts`, `npm run typecheck`, `npm run format:check`. PR remains draft until CI and integration review.
