# DEV-07 native buyer route ownership and maintenance qualification

**2026-11-13 — Integration candidate, not accepted deployment.**

## Source ownership and dependency

The guarded Medusa `POST /store/b2b/buyer-commit` route is implemented by Trade #189 in `src/api/store/b2b/buyer-commit/route.ts`. Its paired security regression is `tests/native-buyer-commit-route.test.ts`. Main contains the regression import but not the route: this causes TS2307 in unrelated maintenance PRs. Do not remove the regression or add a stub route to hide the problem.

This integration branch starts **at the exact Trade #189 head** `d59a500f78038252bd37b27aec22d134a00b36af`, and layers the Shared Foundation workflow pin change from #191 on top. This provides a coherent, compilable source baseline for qualification without activating production checkout or pretending that #189's business acceptance has passed.

## Security invariants

- The native route is disabled unless its explicit development/integration flags and environmental profile permit it; staging and production remain denied.
- The confidential BFF caller JWT and human buyer JWT require verification; IAM issuer and authorised-party checks precede consequential native operations.
- Buyer principal, CP estate/tenant binding, market/country and seller legal-entity mandate must be resolved from authoritative providers, not caller assertions.
- Prices, tax, duty and freight are read from governed cart/native pricing providers; no browser-declared financial inputs are accepted.
- Medusa native order, seller and buyer commitment receipts, buyer spend reservation and canonical outbox must share one PostgreSQL transaction, with replay/unknown-outcome controls.
- Negative tests are retained and are not equivalent to witnessed genuine buyer transaction evidence.

## Acceptance and merge order

1. Qualify the exact integration branch with Code Quality, CI, Foundation, Security, Release Readiness and native DEV-07/DEV-11 workflows. Audit security advisories after the expired exceptions were removed.
2. Qualify #189 separately with **genuine** provisioned IAM/CP buyer, real Medusa cart/final price, approved signer and active budget, then independent readback of non-draft order, commitments and original outbox event under one transaction ID. No fabricated positive or silent bypass.
3. Only after #189's documented hold is lifted and merged into main, retest the routine maintenance PRs against the resulting main. The Shared workflow upgrade should then be reconciled to #191 or this stacked integration candidate; do not merge a dependency branch containing unaccepted DEV-07 work directly into main.
4. Major Node, Python, Medusa and OpenTelemetry upgrades require separate native/runtime compatibility evidence.

**Current status:** source baseline reconciled; runtime acceptance and latest-head CI pending. No protected deployment authorisation.
