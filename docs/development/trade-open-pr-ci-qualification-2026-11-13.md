# Trade open-PR CI qualification — 2026-11-13

## Inventory
Live GitHub inventory: 43 open PRs: #186, #189–#225 (except #226), #227–#231. PR #189 integrates the original RabbitMQ/outbox publisher and DEV-07 native buyer route; its green CI does not qualify the missing genuine IAM/CP approved, non-draft, same-XID checkout. Its existing PR description explicitly says HELD. #200–#225 and #227–#231 are draft ADR corrections with explicit connected-evidence gaps. Do not mistake passing source-only regressions for operational acceptance.

## Independently verified CI causes
1. Main contains tests/native-buyer-commit-route.test.ts importing ../src/api/store/b2b/buyer-commit/route, while the route exists only on held #189, not main. Both release and foundation container builds fail TS2307 (jobs 128976114451, 128976190166). Fix only by reconciling actual guarded native-route ownership and authorization; do not create a fake writer, delete the negative test or activate checkout.
2. An unformatted version of that test fails npm run format:check (job 128976115171). PR #191 now carries the formatted regression already present on #189 (commit 7330a72d), a bounded nonfunctional correction.
3. Shared foundation classifier currently rejects the dependency-audit exception in .baobab/repository.yaml, which expired 2026-11-09 (job 131633324813). container-scan shares the expired date. Do not silently extend acceptance. Re-run dependency and container scans; obtain explicit bounded owner approval if findings cannot yet be fixed, with scope, compensating controls and current risk evidence.
4. PR #191 advances the Shared foundation reusable workflow pin while retaining an older foundation_ref input. Check Shared compatibility and evidence requirements before changing either.

## Recommended integration groups
A. Repair base route/test ownership, formatting, Medusa/PG17 builds and expired security control without bypasses.
B. Reconcile maintenance #186 and #190–#199: Node 26 versus Node 24 contract, Medusa dependency lockstep, OpenTelemetry 3 major, Python 3.15, action/reusable workflow pins. Do not blindly combine all majors; keep Trade npm lockfile authoritative.
C. Audit #200–#211 by startup/tenancy and product/price/inventory/order/payment/fulfilment/tax changes. Stack only where code paths overlap; state ancestor heads.
D. Audit #212–#225 by ERP/finance, regulatory/documentary, logistics, supplier and buyer KYB/certification. Preserve independent provider-readback requirements.
E. Audit #227–#231 with #189 for CP/IAM Market, estate assignments, production credential cutover, spend locks, non-draft order, original event and ERP replay. Keep universal native fence SHADOW pending accepted authorization and independent evidence.

## Merge criteria
Exact final-head green required checks; reviewed P1 findings; formatter, typecheck, build, Medusa/PG17 and negative authority tests; compatible Shared pins; security risk policy; source and runtime evidence custody; documented consumer impact. Never equate an old green run, source-only conformance, or a test fixture with actual accepted buyer commerce, payment, freight or ERP effects.

Relevant links: https://github.com/baobab-platform/baobab-trade/pull/189 ; https://github.com/baobab-platform/baobab-trade/pull/191 ; https://github.com/baobab-platform/baobab-trade/pull/189#issuecomment-6661381882
