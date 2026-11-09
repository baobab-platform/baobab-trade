# ADR-0012 pricing implementation audit — 2026-11-09

**Governing document:** Accepted `docs/adr/ADR-0012_ MedusaJS Commerce Pricing, Price Lists, Promotions and B2B Commercial Terms.md`.

**Disposition: PARTIAL; connected pricing acceptance HELD.** This PR is the first bounded tranche in the requested ADR-0012→ADR-0036 sequence. Later ADRs must be audited against their own accepted text and implemented in distinct PRs, not marked complete by this change.

## Existing implementation
- `src/baobab/pricing/decision-port.ts` supplies a simple `MedusaPricingDecisionAdapter`, `selectPrice`, precedence rules, minimum order and Market status checks.
- `src/modules/b2b/models/contract-price.ts` stores organisation, variant, Market, currency, amount, agreement reference, status and validity.
- `src/modules/b2b/models/commercial-terms.ts` stores organisation, Market, agreement, Incoterm and temporal scope.
- `tests/pricing-decision.test.ts` verifies simple contract, quantity tier and organisation precedence, but not duplicate/overlapping terms or temporal/legal-seller scoping.

## Critical defects remediated
1. **ADR-0012 §§4–5, 8, 17, 22–24, 67–70, 104–105:** Candidate selection previously considered only currency, organisation and quantity, silently accepting a different Market/variant/legal seller and expired/future terms if the candidate provider returned them. Optional explicit scopes are now checked and refused when mismatched.
2. **ADR-0012 §§48, 91–94:** Invalid fractional, negative, unsafe or non-finite monetary amounts and malformed effective timestamps are now refused. The pure port's `amount` is interpreted as integer minor units for its own conformance; this is **not** a claim that all native Medusa pricing uses that representation.
3. **ADR-0012 §§25–28, 67–70:** Two applicable same-precedence candidates previously resolved by provider array order. Such ambiguous/overlapping contract or quantity rules now fail closed, without opportunistically selecting the cheapest candidate.
4. **ADR-0012 §§42–46, 67–70:** Regression cases verify no buyer/Market/seller/variant cross-context leakage or expired price adoption.

## Important remaining gaps
- The `PriceCandidateProvider` is not yet a qualified real Medusa Pricing Module reader with verified IAM/CP legal-seller, Market, buyer organisation and contract binding. Existing candidate fields are optional for legacy compatibility, and **unscoped candidates remain possible**; they must not be treated as production B2B entitlements. A stronger production provider should require explicit authoritative dimensions.
- The port currently defaults to local `Date.now()` when `effectiveAt` is missing. The final checkout path must supply a server-owned fixed effective instant and persist it in immutable order price provenance.
- Medusa native price lists, promotions, promotion stacking, manual discounts, organisation-specific confidential pricing on list/search/direct ID, cache isolation, currency/rounding, FX, credit/payment terms and promotion concurrency are not qualified.
- Real `cart → final native price → approved buyer commitment → order line snapshot → outbox → ERP` evidence is not delivered by this isolated pricing change; coordinate with open Trade #189 rather than inventing a duplicate checkout framework.
- The existing full-repo `tests/native-buyer-commit-route.test.ts` references a route missing from main, and main formatting is broken for that test; this PR does not suppress these failures.

## Acceptance
- Run `tests/pricing-decision.test.ts` and `tests/adr-0012-pricing-context.test.ts` in the dedicated development workflow.
- The workflow must be read-only (no formatter writes); independent full-repository CI remains required before merging.
- This tranche is **not ADR-0012 full acceptance**, and does not close any later ADR.
