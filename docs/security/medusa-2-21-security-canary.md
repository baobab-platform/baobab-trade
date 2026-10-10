# Medusa 2.21.2 and Vitest 5 security compatibility gate

**State:** migration canary only; not a production upgrade approval. **Baseline:** Medusa 2.20.1 and Vitest 3.2.7; Node 24.18.1. **Proposed:** all five direct Medusa packages at 2.21.2 and Vitest 5.0.3.

## Security motivation and non-force remediation

The previous branch ran an actual `npm audit fix --package-lock-only` without `--force` and left 102 full-tree vulnerabilities, of which 94 affect the production audit (zero production critical, 28 production high). The remaining major blockers are upstream and include Medusa-pinned OTel/GraphQL/transitives, `braces` and test-only `tinypool` / Vitest 3.

This branch is a separate **canary** to assess Medusa 2.21.2 and Vitest 5.0.3 without silently forcing incompatible transitive packages. A green TypeScript compile and unit suite alone do not prove browser Store API compatibility.

## Breaking Store API security change (2.21.0+)

Medusa 2.21 introduces strictly matched allowed fields/relations on built-in Store API routes. A previously accepted request for `region.id` or an expanded product association might now have its unapproved field silently stripped. Medusa 2.21.2 also prevents `/store/search` from expanding outside the indexed fields.

No global `allowFields('*')`, arbitrary relation-depth allowlist or broad override is permitted. Each ZuriBeans/Thamani consumer must document its requested `fields` selection and use only the minimal explicit allowed paths required for its verified UX. Any additional allowance must be per-route, reviewed for PII/tenant isolation, and covered by a negative test proving internal relationships cannot be exposed.

## Acceptance matrix before any merge

| Gate | Evidence required | Current state |
| --- | --- | --- |
| npm dependencies | Generated reproducible lock; `npm ci` under Node 24 | CI candidate |
| Medusa API coherence | Exactly aligned `@medusajs/*` release and admin-sdk | CI candidate |
| Vitest 5 | No changed mock isolation, unawaited expectations, snapshot mismatches or silenced failures | CI candidate |
| Medusa native checkout | Existing single `completeCartWorkflow.validate` registration, Thamani eligibility and staged LA-05 pre-commit denial | Staging E2E needed |
| Store API | All explicitly selected ZuriBeans and Thamani fields verified under exact-field allowlist | Not accepted |
| Search | Search index/projection fields resolved without unauthorised `query.graph` re-expansion | Not accepted |
| Security | Production and full-tree Foundation npm, portable Trivy, container scans genuinely green | Not accepted |
| Go-live | Production CI, provider approvals, tenant/context/mandate/merchant authorisation independently demonstrated | Not accepted |

## Safe rollback

Retain the last Medusa 2.20.1 deployment as a separate immutable release; migrating Store API consumption is a reviewed cutover, not an ad-hoc overwrite. Do not downgrade a running database after applying future Medusa migrations without an approved snapshot/tested rollback. No legal actor, merchant or entitlement rights are granted by changing package versions.
