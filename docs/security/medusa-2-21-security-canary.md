# Medusa 2.21.2 and Vitest 5 security compatibility gate

**State:** migration canary only; not a production upgrade approval. **Baseline:** Medusa 2.20.1 and Vitest 3.2.7; Node 24.18.1. **Proposed:** all five direct Medusa packages at 2.21.2 and Vitest 5.0.3.

## Security motivation and non-force remediation

The previous branch ran an actual `npm audit fix --package-lock-only` without `--force` and left 102 full-tree vulnerabilities, of which 94 affect the production audit (zero production critical, 28 production high). The remaining major blockers are upstream and include Medusa-pinned OTel/GraphQL/transitives, `braces` and test-only `tinypool` / Vitest 3.

This branch is a separate **canary** to assess Medusa 2.21.2 and Vitest 5.0.3 without silently forcing incompatible transitive packages. A green TypeScript compile and unit suite alone do not prove browser Store API compatibility.

## Breaking Store API security change (2.21.0+)

Medusa 2.21 introduces strictly matched allowed fields/relations on built-in Store API routes. A previously accepted request for `region.id` or an expanded product association might now have its unapproved field silently stripped. Medusa 2.21.2 also prevents `/store/search` from expanding outside the indexed fields.

No global `allowFields('*')`, arbitrary relation-depth allowlist or broad override is permitted. Each ZuriBeans/Thamani consumer must document its requested `fields` selection and use only the minimal explicit allowed paths required for its verified UX. Any additional allowance must be per-route, reviewed for PII/tenant isolation, and covered by a negative test proving internal relationships cannot be exposed.

## Acceptance matrix before any merge

| Gate                   | Evidence required                                                                                                    | Current state      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------ |
| npm dependencies       | Generated reproducible lock; `npm ci` under Node 24                                                                  | CI candidate       |
| Medusa API coherence   | Exactly aligned `@medusajs/*` release and admin-sdk                                                                  | CI candidate       |
| Vitest 5               | No changed mock isolation, unawaited expectations, snapshot mismatches or silenced failures                          | CI candidate       |
| Medusa native checkout | Existing single `completeCartWorkflow.validate` registration, Thamani eligibility and staged LA-05 pre-commit denial | Staging E2E needed |
| Store API              | All explicitly selected ZuriBeans and Thamani fields verified under exact-field allowlist                            | Not accepted       |
| Search                 | Search index/projection fields resolved without unauthorised `query.graph` re-expansion                              | Not accepted       |
| Security               | Production and full-tree Foundation npm, portable Trivy, container scans genuinely green                             | Not accepted       |
| Go-live                | Production CI, provider approvals, tenant/context/mandate/merchant authorisation independently demonstrated          | Not accepted       |

## Safe rollback

Retain the last Medusa 2.20.1 deployment as a separate immutable release; migrating Store API consumption is a reviewed cutover, not an ad-hoc overwrite. Do not downgrade a running database after applying future Medusa migrations without an approved snapshot/tested rollback. No legal actor, merchant or entitlement rights are granted by changing package versions.

## Verified source-level consumer inventory (10 October 2026)

This is **consumer-source verification**, not a live backend or business go-live certification. The 2.21 exact-path allowlist and 2.21.2 search-index-only restriction are verified against Medusa's release notes; the actual callers were inspected in the two live frontend repositories.

| Consumer                           | Direct calls observed                                                                   | Explicit `fields` | Core `/store/search`            | Must still prove in a 2.21.2 runtime                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------- | ----------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `baobab-platform/zuribeans`        | 3 × `product.list`, 1 × `category.list`, 1 × `customer.retrieve`, 1 × `customer.create` | **None**          | **None**; product list uses `q` | Product `metadata`, `categories[].name`, `variants[].{id,title,sku}`, market `q`/assortment and logged-in customer              |
| `baobab-platform/thamani` (legacy) | 2 × `product.list`, cart `create`, `createLineItem` and `retrieve`                      | **None**          | **None**; product list uses `q` | `variants[].calculated_price`, region-bound cart items and no silent default field removal; **not** B2B logistics certification |

The review created **ZuriBeans #107** (static + strict staging smoke) and **Thamani #20** (legacy source/ADR inventory and optional legacy smoke). They must pass their own checks. Neither repo presents any explicit `fields` selector requiring a speculative `allowFields` override today; do **not** broaden Medusa public Store queries preemptively. Route defaults and actual response shapes must be checked with a seeded 2.21.2 server.

**Major architecture correction:** Accepted `thamani/docs/adr/ADR-THA-0018` supersedes Thamani's original B2C storefront with a B2B integrated logistics business. The current Medusa retail code is legacy. A passing old cart smoke does NOT authorize that estate's future RFQ/service-contract/booking flows. Keep separate TMS, Trade Docs, ERP, CP and IAM capability evidence.

Medusa 2.21's stricter field selection is a security improvement; absence of `fields` does _not_ prove ZuriBeans' default metadata/category/variant projections survive. Tests must fail when required projections disappear rather than silently substituting `[]`, hiding missing information behind display fallbacks or adding wildcard `allowFields`.

### Promotion blockers

- Obtain ZuriBeans #107 and Thamani #20 static inventory CI results and remediate test failures.
- Stage Trade **actually built with Medusa 2.21.2**, then run the documented HTTPS consumer smoke scripts with _real_ sales-channel, product/market and test customer credentials. Neither script substitutes a mock Store API.
- If any explicitly required field disappears, inspect the **installed version's** exact allowed defaults, use an explicit request selector for safe core-allowed fields or propose one route-scoped, enumerated `allowFields` addition with a negative private-relations expansion test. No wildcard, Store relation depth increase or universal selector.
- Verify full Store API negative cases, stock/pricing, cart/completeCartWorkflow, Thamani eligibility on still-reachable legacy paths, tenant separation and LA-05C3 production PEP rules independently.
- Ensure npm/Trivy security gates are actually green before production promotion.
