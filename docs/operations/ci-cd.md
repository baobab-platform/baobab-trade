# CI/CD and production conformance

Gate 17 makes release readiness machine-testable. `conformance/production-controls.json` is the auditable control inventory; tests prove the declared runtime, architecture constraints, documentation and workflow coverage have not drifted.

Pull requests must pass formatting, lint, type-checking, unit/contract/isolation/security/conformance tests, build, fresh-database migration and Gates 1–13 integration, production-provider migration, CodeQL, action pinning, dependency/secret/container scanning and the release-readiness build. Deployment remains owned by `nabhold/infrastructure`; this repository produces a verified release candidate and does not embed cloud credentials or topology.

Failures block promotion. Bypassing a failed conformance check requires an explicit, reviewed change to the control inventory or workflow—not a retry until the lights happen to turn green.

## Gate 21 reproducible release and rollback evidence

`release-readiness.yml` builds the image with an immutable, addressable tag (`baobab-trade:<git-sha>`, ADR-0008 §115) and runs `npm run release:manifest` (`scripts/generate-release-manifest.ts`), which records exactly what that build validated — the image tag, the application/Medusa/Node/contracts-consumer versions, and the commit — as `release-manifest.json`, uploaded as a 15-day build artifact (this repository's maximum allowed retention). This is the evidence trail for "what specific artefact was tested," satisfying ADR-0008 §117 (release versioning); it does not publish the image anywhere — publishing and deploying it is `nabhold/infrastructure`'s job.

Rollback _evidence_ — the documented rollback/forward strategy for migrations, and the failed-migration/restore-from-backup runbooks ADR-0008 §92/§113 require — lives in `docs/operations/runbooks/migrations.md`. Executing a production rollback or a backup restore remains `nabhold/infrastructure`'s job (`docs/architecture.md`).
