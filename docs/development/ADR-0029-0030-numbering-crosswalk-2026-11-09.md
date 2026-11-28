# ADR-0029 / ADR-0030 identity crosswalk — 9 November 2026

**Decision:** Both pairs are independently **Accepted** decisions; no evidence in their texts declares either member of either pair superseded. Retain their existing paths and historical citations. Never resolve an ambiguous bare ADR number silently.

| Stable citation key (documentation only) | Authoritative file | Gate | Authority / subject | Main implementation boundary |
|---|---|---|---|---|
| TRADE-ADR-0029-ZB03.7 | `ADR-0029 — Real-Token Integration Verification for Buyer Trade Authorization.md` | ZB-03.7 | Medusa buyer JWT signature, expiry, actor identity and route binding | `tests/authenticate-middleware.test.ts`, `tests/b2b-context-route.test.ts`, Medusa middleware |
| TRADE-ADR-0029-ZB04 | `ADR-0029_ ERP Commercial Profile Consumption and Buyer Activation.md` | ZB-04 | ERP-origin commercial-profile receipt and Trade buyer activation | `src/api/events/inbound/erp/route.ts`, `tests/buyer-commercial-profile-consumer.test.ts` |
| TRADE-ADR-0030-ZB06 | `ADR-0030 — Gate ZB-06 Product Trade Profile and Market Assortment Boundary.md` | ZB-06 | Commerce product projection, CP external reference, commercial assortment and market regulatory gating | `src/baobab/b2b/product-assortment-policy.ts`, Medusa assortment and admin endpoints |
| TRADE-ADR-0030-ZB04 | `ADR-0030_ Buyer KYB Evidence and Verification Gate.md` | ZB-04 | Buyer-application scoped documentary evidence verification before review/approval | `src/baobab/b2b/kyb-evidence.ts`, application evidence and review endpoints |

## Precedence and non-supersession

- ADR-0029 ZB-03.7 proves the existing Medusa authentication boundary against *test-signed* JWTs. It does not provide ERP event authenticity, and neither signature test alone proves live IAM issuance.
- ADR-0029 ZB-04 consumes ERP commercial-profile changes. This cannot replace current IAM/CP Principal, Tenant, LegalEntity and buyer-membership authority; profile approval alone is not final checkout authorization.
- ADR-0030 ZB-06 owns commercially visible product/Market projections and never treats an HS reference as regulatory law, customs clearance, tax decision or ERP stock/valuation. ADR-0024 supplies the deeper regulatory product model; later Shared/CP authority constrains both.
- ADR-0030 ZB-04 owns KYB evidence associated with buyer onboarding, not product classification. ADR-0025's canonical document custody and validation requirements continue to apply.
- A buyer can satisfy ZB-04 KYB and fail ERP activation; an ERP-approved buyer can still fail IAM/CP current authority; an ACTIVE assortment can still fail product regulatory eligibility. These decisions are conjunctive, not substitutes.

## Governance remediation

1. Preserve the original decision filenames; many existing ADR references depend on them.
2. Use the **gate-qualified citation keys** above in all new PRs, test manifests and architecture traceability.
3. The Platform Owner should register non-colliding replacement IDs or aliases in the authoritative ADR index as a controlled documentation-only change. Until that occurs, do not rename files, rewrite historical lineage or claim one supersedes the other.
4. Implement and review each independent decision within its own gate and PR. ADR-0029's current implementation audit is in PR #222, ADR-0030's in PR #223. This crosswalk is filed with PR #223 because it completes the last collision in sequence.

**Acceptance status** is a governance designation, not evidence of connected runtime qualification; each gate retains independent real-IAM/CP/ERP/document-provider and replay obligations.
