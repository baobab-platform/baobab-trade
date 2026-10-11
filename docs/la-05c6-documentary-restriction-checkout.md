# LA-05C6 — Current documentary remediation veto before Medusa checkout

Companion to CP PEO-02T (CP PR #326), scoped to Trade's existing native
`completeCartWorkflow` validation hook.

When the native legal-seller gate is explicitly enabled in an approved
nonproduction environment, a cart completion must now satisfy THREE separate
authorities, not one:

1. Fresh CP legal-actor responsibility for the immutable server-owned cart
   binding (existing LA-05C4);
2. Current CP **negative-only** documentary remediation assessment for the
   same runtime Context, exact Organisation, capability, market and operation;
3. Separately verified Payments/provider readiness (existing LA-05C3).

The documentary veto is queried **twice**: before provider readiness and again
immediately before native completion, after re-reading the server-owned
binding. An HTTP error, `blocked:true`, mismatched scope, positive
`authority_granted`, stale timestamp or excessive lease fails closed.

The new `HttpDocumentaryRestrictionClient` accepts only HTTPS endpoints
(localhost HTTP is restricted to tests), sends a workload bearer credential
and correlation ID, and never caches. The client response alone is not trusted:
`assertUnblockedDocumentaryScope` checks all operation bindings and validity.

## Operational gates

- CP PR #326 must merge, pass CI and be deployed in approved staging.
- IAM must issue/register `documentary:restriction-assess` for the exact
  Trade workload and CP must list that client explicitly.
- The Medusa native seller guard and required dependencies must be wired via
  reviewed server-owned configuration; no storefront-selected endpoint or actor.
- Payments provider certification remains independently required; a missing
  documentary hold alone never makes checkout eligible.
- Synthetic checkout and revocation-race staging evidence, deployment rollback
  and security acceptance are still required.

This change does **not** declare Medusa checkout production-certified and
does not alter the default-off/production-denied behaviour of the native guard.
