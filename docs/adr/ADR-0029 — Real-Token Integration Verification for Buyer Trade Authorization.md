# ADR-0029 — Real-Token Integration Verification for Buyer Trade Authorization

**Status:** Accepted
**Date:** 2026-09-18
**Decision Owners:** NABHOLD / Baobab Platform Architecture
**Primary Repository:** `nabhold/baobab-trade`
**IAM Authority:** `nabhold/baobab-iam` / Keycloak

## Related Decisions

- ADR-0017 — Customer, B2B Organisation, Buyer Identity and Authorization Model
- `nabhold/baobab-iam/docs/governance/gate-iam-6-zuribeans-b2b-scope.md` — names this gap explicitly
  ("closing the gap between 'unit-tested against fixtures' and 'proven against the real
  IAM → CP → Trade chain'")
- `nabhold/baobab-cp/docs/reconciliation/gate-zb03-authority-contract-freeze.md` — lists ZB-03.7
  alongside ZB-03.6/ZB-03.8 as context/authorization work still to land

## 1. Context

`GET /store/b2b/context` and `POST /admin/b2b/organisations/:id/canonical-link` are already
protected by the real, unmodified `authenticate()` middleware from `@medusajs/framework/http`
(`src/api/middlewares.ts:14,19`) — there is no header-trusting shortcut, no mock authentication, and
no route that bypasses it in production code. `medusa-config.ts`'s `authMethodsPerActor`
configuration correctly keeps the workforce `oidc` provider off `/auth/customer/*`.

The gap is in verification, not production logic: nothing in this repository ever drove
`authenticate()` through an actual signed JWT.

- `tests/b2b-context-resolver.test.ts` calls `resolveBuyerContext(b2b, orgId, customerId)` directly
  with a hand-typed `customerId` string — never the `actor_id` a real, verified token would produce.
- `tests/auth-providers.test.ts` only asserts `buildAuthProviderConfiguration()`'s config shape
  (which providers/callback URLs get registered) — it never boots the route and never checks that an
  expired, forged, or wrong-actor-type bearer token is actually rejected.
- `src/api/store/b2b/context/route.ts`'s `req.auth_context.actor_id` usage was exercised in zero
  tests.

This matters because the entire point of `authenticate()` sitting in front of this route is to
guarantee `req.auth_context.actor_id` is a value the caller cannot forge. A test suite that only
ever hand-constructs that value proves the business logic downstream of authentication is correct,
but never proves authentication itself actually stops a forged, expired, or wrong-actor-type token
before that business logic runs.

## 2. Decision

Add integration-style tests that exercise the real, unmodified `authenticate()` export against
actual signed JWTs, and the real `GET` route handler using an `actor_id` recovered from one of those
verified tokens — not a new production feature.

1. `tests/support/real-token.ts` — signs a JWT via `jsonwebtoken` (already a transitive dependency
   of `@medusajs/framework`; promoted to an explicit `devDependency` in this slice) shaped exactly
   like the payload `getAuthContextFromJwtToken` verifies and assigns verbatim as `req.auth_context`
   (confirmed by reading
   `node_modules/@medusajs/framework/dist/http/middlewares/authenticate-middleware.js`: `jwt.verify`'s
   return value IS the auth context, with no further mapping).
2. `tests/authenticate-middleware.test.ts` — imports `authenticate` directly from
   `@medusajs/framework/http` and drives it with a fake `req.scope.resolve` supplying a test
   `jwtSecret`, covering: missing header, valid signature, forged signature, expired token, and
   correct-signature-wrong-actor-type (a workforce `user` token must never authenticate a
   customer-only route).
3. `tests/b2b-context-route.test.ts` — imports the real exported `GET` handler from
   `src/api/store/b2b/context/route.ts` and calls it with `auth_context.actor_id` recovered by
   verifying a real signed token (not typed by hand), proving the actor-id binding from token → route
   → `resolveBuyerContext` holds end-to-end, including the IDOR case (a validly-signed token for an
   actor with no membership in the requested organisation).

## 3. Why this is test-only, not a production change

Investigation (grep for TODO/FIXME/mock/stub near auth-sensitive code, and reading
`authenticate-middleware.js` itself) found no production-code authentication gap: real signature
verification, real expiry enforcement, and real actor-type matching were already in force before this
slice. Gate ZB-03.6 and Gate ZB-03.3 already added real cross-system verification (Control Plane
tenant/organisation attestation); this slice closes the remaining gap named in
`gate-iam-6-zuribeans-b2b-scope.md` — proof that the token-verification boundary itself behaves as
claimed — without adding, removing, or changing any request-handling code path.

## 4. Consequences

- `jsonwebtoken` and `@types/jsonwebtoken` are now explicit `devDependencies` (previously only
  transitively present via `@medusajs/framework`), so test code doesn't rely on hoisting.
- Any future change to `src/api/middlewares.ts`'s actor-type/auth-type wiring, or to
  `medusa-config.ts`'s `jwtSecret`/`jwtPublicKey` configuration, is now covered by a test that fails
  if the real verification boundary regresses (e.g. a route accidentally accepting the wrong actor
  type, or `ignoreExpiration` being silently enabled).
- This does not test against a live Baobab IAM-issued token (Keycloak isn't reachable from this
  environment) — it tests the verification contract `authenticate()` itself implements, which is the
  same contract a live IAM-issued token must satisfy. Full live-issuer proof remains scoped to
  ZB-03.10's cross-repository isolation certification suite.
