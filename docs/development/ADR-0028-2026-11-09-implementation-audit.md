# ADR-0028 follow-up implementation audit — 9 November 2026

**Status:** Accepted. Existing ADR-0028 opt-in workload verification architecture is preserved.

## Audited source behaviour

The workload verifier correctly re-attests the tenant and canonical Organisation through a workload token; it checks CP's echoed tenant/organisation and selected country. However, if CP returned a syntactically valid but already-expired expires_at timestamp, the verifier returned that expired context to its caller. The configured verifier must not treat such a response as current tenant authority.

## Bounded correction

When CP provides a lease expiry, reject any invalid or expired value even if HTTP 200 and exact tenant/Organisation echoes match. Preserve the intentionally opt-in verifier and optional expiry for the existing CP contract. New negative tests cover expired and malformed responses.

## Remaining evidence

This is not a live Keycloak/IAM client-credential proof or a real CP resolve call. ZB-03.10 real-token and cross-repository attestation remains held. An absent verifier intentionally retains legacy behavior per the original ADR; a separate approved rollout is needed to require it in production.

Validation:

    npx vitest run tests/workload-tenant-verifier.test.ts
    npm run typecheck
    npm run format:check

Draft until tested.
