# BA-SEC-DEP-001 — Trade dependency security-maintenance adoption

**Policy:** [Approved Shared v1.0](https://github.com/baobab-platform/shared/pull/429). Strict implementation in Shared #429 is still unmerged and must not be treated as a released validator.
**As reviewed:** 7 November 2026. **State:** SOURCE_COMMITTED; CI_VERIFIED, SECURITY_ALERT_PATH_VERIFIED and CONSUMER_QUALIFIED remain NOT VERIFIED.
**Owners:** Trade Engineering, Baobab Platform Engineering and independent Security.

## Actual source inventory

| Actual input | Dependabot coverage | Qualification boundary |
| --- | --- | --- |
| `.github/workflows/*.yml` | `github-actions` at `/` | SHA-pinned Actions and reused Shared workflow provenance |
| `package.json` / `package-lock.json`; npm/MedusaJS | `npm` at `/` | Native Medusa runtime, buyer/seller authority, reservations, outbox/idempotency |
| Root `Dockerfile`, `Dockerfile.dev07*`, `Dockerfile.dev11-rabbit-dispatcher` | `docker` at `/` | Runtime image, Node ABI, single business transaction, publisher/consumer |
| `docker-compose.yml` root PostgreSQL17/Redis development topology | `docker-compose` at `/` (**new**) | Real local topology, no production approval |

Monday Africa/Johannesburg schedules are staggered; bounded PR limits, labels and commit prefixes are retained. The duplicate `target-branch: main` overrides are removed. A minor/patch-only Actions version group has explicit `applies-to: version-updates`; npm/Medusa and Docker version changes are deliberately left ungrouped for native owner review. Security patches are independent of routine cadence, and no blanket ignore was added.

**Toolchain**: Trade DEV-10 PR [#186](https://github.com/baobab-platform/baobab-trade/pull/186) is a separate Node 26/npm migration, and DEV-07/DEV-11 Trade PR [#189](https://github.com/baobab-platform/baobab-trade/pull/189) has held native buyer/transaction acceptance. This policy PR changes neither branch's runtime engine, protected flags nor business transaction code. Preserve versioned CLI/lockfile coupling and re-evaluate major candidates on those owner PRs.

## P0 — expiring native dependency and image-scan exceptions

Current `.baobab/repository.yaml` declares `dependency-audit` and `container-scan` exceptions for upstream Medusa `braces` and `@graphql-tools/utils` dependencies, each with **expires: 2026-11-09** and `approved_by: @bjnabs`. This is a **source declaration**, NOT independent proof that the approver was authorised, that the vulnerabilities are unreachable or that the exemptions meet Shared policy §12's full required metadata (ID, exact versions/paths, exploitation/exposure, compensating control, owner, remediation issue, independent approval). No new exception, renewal or waiver is invented.

On **10 November 2026**, the recorded expiry is in the past. The local BA-SEC-DEP-001 test then fails closed until the owner remediates or a new independent, complete, time-bounded decision is recorded. An expired waiver is BLOCKED, never PASSED.

## Daily native security scan

The existing `.github/workflows/security.yml` now runs a **daily full-tree npm advisory audit**, using the repository-owned `.nvmrc`, `npm ci --ignore-scripts` and `npm audit --audit-level=high` without `--omit=dev` or blanket ignore. Security threat-model/PII negatives, CodeQL and existing Foundation security hooks remain. A native advisory failure is not silently waived by this new job: the affected dependency must be fixed, dispositioned via independently approved, current policy, or held.

The Actions pinning and accepted immutable Shared Dependabot structure gate remain, complemented by **local negative source tests**. The new Shared #429 strict validator is NOT pinned while unmerged.

## Qualification before merge or protected promotion

1. Run `python3 -m unittest discover -s tests/unit -p 'test_dependency_maintenance.py' -v`, current-head Trade CI, the daily native audit and Foundation. Resolve any observed vulnerabilities or explicit exception gaps.
2. Verify real Dependabot npm/Docker/Compose version jobs, GitHub dependency graph, Alerts and automatic security updates, native package-lock integrity and pinned Actions/image advisories. Source config is only one input.
3. Preserve canonical Trade/CP/IAM authority and **negative tests**: approved signer, seller binding, market, price digest, budget, buyer spend reserve, single XID, seller commitment, immutable Trade outbox; replay/duplicate-order refusal and real RabbitMQ→ERP evidence. No synthetic price-origin substitute.
4. Major Node/Medusa/dependency upgrades require native provider qualification, independent protected approvals and migration/recovery checks, not simply bot CI success.
5. Track SOURCE_COMMITTED, CI_VERIFIED, SECURITY_ALERT_PATH_VERIFIED, CONSUMER_QUALIFIED, WAIVED, BLOCKED and protected readiness as distinct evidence states.

**This PR is policy source adoption only. It does not approve Trade #189, Trade #186, a real Medusa buyer order or staging/production execution.**
