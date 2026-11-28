# DEV-07 native buyer route ownership and maintenance qualification

**Updated 2026-11-27. Integration candidate.**

## Source ownership and dependency

Trade #189 owns the guarded Medusa `POST /store/b2b/buyer-commit` route in
`src/api/store/b2b/buyer-commit/route.ts` and its paired regression in
`tests/native-buyer-commit-route.test.ts`. Trade #239 restored main to
a coherent baseline. The native route and its tests are qualified together
on the owning #189 branch.

This branch uses Trade #189 at `1c10376ca2c3ffb4106b31f64859bdeaa7d22d99`.
Foundation and CodeQL use accepted Shared main at
`5664b1669736ddc0807709c9d2a1646325c4309a` (Shared #470). The Foundation action
and policy checkout use the same Shared revision. The Python setup pin retains
the already tested 3.14 scope. Trade #237 is a separate newer setup-action
candidate. Trade #235 is a separate Shared CodeQL candidate.

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

**Current status:** source baseline reconciled. Runtime acceptance and CI on the updated branch are pending.
