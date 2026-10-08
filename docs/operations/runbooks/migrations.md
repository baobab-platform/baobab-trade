# Migrations runbook

ADR-0008 §92 requires migration order and rollback/forward strategy to be documented; §113 requires a runbook for a failed migration and for restoring from backup. This repository owns the migrations and the strategy below; executing a production rollback or a backup restore is `nabhold/infrastructure`'s job (`docs/architecture.md`), not this repository's.

## Rollback/forward strategy

Every module's migrations run through Medusa's own migrator, which supports a mechanical `down()` per migration. In this codebase that `down()` falls into exactly two shapes, and which shape a given migration uses is a deliberate choice, not an oversight:

- **A genuine reversal** — the migration created a table, column, index or constraint that carries no data from before the migration ran, so `down()` drops it outright (e.g. every migration that creates a new `*_reconciliation`/`*_projection` table drops that same table in `down()`).
- **An intentional no-op** — the migration only _widened_ something that already had rows using the wider range the moment it ran (a `CHECK` constraint's admitted enum values, a unique index's scope). Narrowing it back in `down()` risks either deleting rows that legitimately need the wider range or failing outright against real data. `Migration20260909090000` (`erp-integration`) and `Migration20260909170000` (`fulfilment-bridge`) document this reasoning inline at the point it applies — read the specific migration's own comment before assuming any narrowing migration's `down()` does something.

**Before rolling back any migration in production**: read that migration's own `down()` body first. If it's a no-op, rolling back the _migration_ does nothing — recovering from a bad deploy that depended on the wider range means rolling back the _application code_ that used it, not the schema.

## Failed migration

1. `npm run migrate` (Medusa's own migrator) fails and stops before completing — it does not leave the database half-migrated across multiple migrations; only the one that failed is unapplied.
2. Read the migrator's own error first. A failed `CREATE TABLE`/`ALTER TABLE` against a fresh CI database (the `core-module-integration` job runs every migration against a clean Postgres on every PR) is a bug in the migration SQL itself — fix and re-run the fresh-database migration check before touching production.
3. A migration that passed in CI but fails in production almost always means production has _data_ CI's fresh database never had (a `CHECK` constraint or unique index migration failing against a real row that violates it). Do not "fix" this by weakening the constraint in production by hand — write a new migration that reconciles the offending rows first, matching how `Migration20260909180000` widened a constraint rather than any migration ever narrowing one under load.
4. Do not re-run `npm run migrate` in a loop hoping it succeeds — Medusa's migrator is not idempotent against a half-failed transaction the way this repository's own `*RecordAdapter`s are; a failed migration needs a human to read the error before retrying.

## Restore from backup

Backup storage, retention and the restore procedure itself belong to `nabhold/infrastructure` (`docs/architecture.md`, ADR-0006) — this repository has no backup/restore tooling and must not invent any. What this repository owns after a restore: **re-running every migration from the restored point forward** (`npm run migrate`) before resuming traffic, since a restore can land on a schema older than the currently-deployed application code expects. Confirm the restored database's migration state against this repository's own migration history before declaring the restore complete.
