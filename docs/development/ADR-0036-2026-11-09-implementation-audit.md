# ADR-0036 implementation audit — 9 November 2026

**Architecture:** Accepted by Platform Owner directive under ADR-SHARED-042 Decision 9. Acceptance of the design is NOT authorization to change a live/staging enforcement gate. The existing migration creates one governed SHADOW row and the universal deferred native commitment trigger, with immutable verdict evidence and SQL protection against unversioned changes. Existing PostgreSQL TA-07 regression exercises actual Medusa cart/draft flows with synthetic CP/IAM.

## Verified test safety defect and fix

The disposable native commit-fence regression changed the gate to ENFORCED, but its ordinary restore to SHADOW occurred only after later scenarios. Any failed assertion or unexpected exception before that restore could strand the same disposable database in ENFORCED. This PR updates the regression's outer finally to restore SHADOW whenever the gate is ENFORCED, before separate tenant fixture cleanup and before closing the pool. It uses the existing revision and evidence reference requirements and a WHERE mode = ENFORCED guard to avoid unnecessary revisions. Nested finally ensures pool disposal runs even if cleanup fails.

## HELD — not release qualification

Do not set the current gate to ENFORCED. Missing proof includes real independent CP resource allocation, IAM workloads and buyer identity, B2B buyer-authority receipt and native spend commitment in one PostgreSQL transaction, same original immutable Trade event and ERP evidence, crash-replay outcomes and independently exported observability. Native B2B commitment still rightly refuses in enforced mode, and current SHADOW evidence is not owner approval. Actual protection of gate mode changes in staging/production requires privileged deployment/DB role controls and approved change procedure. This PR changes only the disposable regression harness, no migrations or production route.

Validation requires the explicitly marked disposable PostgreSQL 17 database and real Medusa migrations: `npm run regression:trade-a-commit-fences`. On any failure, inspect the gate and verify `mode = SHADOW` before reusing the database. No CI green or connected production proof is claimed by this document.
