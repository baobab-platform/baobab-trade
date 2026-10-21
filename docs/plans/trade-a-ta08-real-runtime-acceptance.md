# Trade-A TA-08: real-runtime acceptance and certification

Date: 21 October 2026. Programme: EA v2.3 EA-R03 (§§10.1, 10.3, Track P0-B.3).
Governing decisions: Accepted Shared ADR-SHARED-039 §§1, 3, 4, 6 and 7, and
ADR-SHARED-041.
Evidence classification (EA v2.3 §3.3): `REAL_COMPONENT_SYNTHETIC_DATA`. This
is not L4, not EA Gate D and not protected staging.

## Scope

TA-08 closes Trade-A. It does three things in one change, as the TA-07 record
requires:

1. It certifies `trade.order.commit` and `trade.draft-order.finalize` in
   `PERSISTENCE_FENCED_CLASSES`, so a protected, non-production runtime may
   honour them.
2. It adds the runtime posture check that refuses to honour them against a
   database that is not demonstrably fenced.
3. It runs the real-runtime acceptance that justifies both.

**Certification is not activation.** Every operation still needs:

- explicit enablement (`BAOBAB_TRADE_A_ORDER_AUTHORITY_ENABLED=true`);
- a current CP decision under an ACTIVE CP Seller Operating Binding;
- an independently verified `SELLER_OF_RECORD` mandate for that activity;
- the TA-07 fence consuming the receipt at COMMIT.

Production stays denied whatever is certified. `trade.order.create` has no
governed commit point and stays out.

## Posture check

`assertPersistenceEnforced` runs in a protected runtime for every certified
operation, before any CP call. One statement
(`PostgresPersistencePostureReader`) must show:

| Condition                                                                                    | Refused as               |
| -------------------------------------------------------------------------------------------- | ------------------------ |
| `trade_a_persistence_posture` is `ENFORCED`                                                  | `POSTURE_NOT_ENFORCED`   |
| all nine TA-05/TA-07 fence triggers are enabled on their own tables (`tgenabled` `O` or `A`) | `FENCE_NOT_ACTIVE`       |
| the runtime role is not a superuser                                                          | `SUPERUSER_RUNTIME_ROLE` |

Any refusal answers `403 TRADE_OPERATION_NOT_AUTHORISED`. The reason is logged
for operators only. A read failure, or a runtime with no reader, answers 503.
The check is not cached: a cache would let a disabled fence go unnoticed for
its lifetime, and the check costs one catalog read beside a CP round trip.

A superuser is refused because only a superuser can set
`session_replication_role = replica`, which skips every trigger.

## Corrections TA-08 found

The real CP and the shipped image exposed defects that the synthetic ports and
the source-mode regressions could not. Each is fixed here with a unit test.

| #   | Defect                                                                                                                                                                                           | Fix                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Trade sent `X-Correlation-ID` values such as `trade-attestation/<uuid>`. Shared `control-plane/v1` requires a bare UUID, and the real CP answers 400 `INVALID_CORRELATION_ID`.                   | Attestation, attribution and order authority send a bare UUID.                                                                                                                                                                                 |
| 2   | Attestation and attribution asked CP for a context without an organisation kind. CP then omits `organisation_type`, which Trade's documented "pair" rule refuses, so no real context was usable. | Both request ADR-BCP-024 exact-kind attestation (`ORGANISATION`) and refuse any other echoed kind. This is stronger, and keeps the existing rule.                                                                                              |
| 3   | With a class certified, a denial inside the `completeCartWorkflow` hook reached Medusa's error handler as a serialised plain object, and answered a generic 500.                                 | `createTradeAErrorHandler` maps a thrown, workflow-serialised or fence-raised Trade-A denial to the same RFC 9457 `no-store` document as the route guard. Every other error keeps Medusa's handler.                                            |
| 4   | In staging, the hook still required the LA-05 per-cart seller gate after Trade-A authorised the cart, so certified checkout could never complete.                                                | In a protected runtime the Trade-A receipt is the governed seller gate LA-05 requires. The per-cart binding path is historical evidence and never authority (ADR-SHARED-039 §§1, 3). An explicitly enabled LA-05 guard still runs in addition. |

The harness also showed that the TA-05 PEP needs explicit enablement in every
non-production runtime, staging included. That is intended. The gate now checks
it first, so an un-enabled protected runtime answers 403 `PROTECTED_RUNTIME`
before any database or CP dependency, rather than a 503 for missing
configuration.

## Acceptance (`acceptance/trade-a`)

`run-trade-a.sh` runs `driver/ta08.mjs` against these real components:

- **Trade:** the image built from this repository's `Dockerfile`, under
  `NODE_ENV=staging` and `BAOBAB_ENVIRONMENT=staging`.
- **CP:** the release binary built at a pinned merged commit.
- **Tokens:** RS256 workload and human tokens from a test issuer.
- **Databases:** PostgreSQL 17 for Trade, with a non-superuser runtime role,
  and for CP.
- **TLS:** every hop Trade makes goes through a TLS edge.

CP is seeded through its admin API wherever one exists. That covers the
tenant, the market, both mandates (maker, checker and operator) and the
binding (attested by Trade's own workload, then proposed, approved and
activated by three distinct humans). Rows that CP has no admin API for are
recorded as SYNTHETIC in the evidence: human identities, legal-entity
verification, market assignment, the engine instance and its binding, and the
binding grants. ADR-SHARED-039 §6 requires each certified class to be driven
through its native HTTP route, a direct workflow run and direct SQL as Trade's
runtime role.

| #   | Scenario                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Trade attests its native configuration to CP over TLS; CP records the workload, digest and market from the RUNTIME context      |
| A02 | The binding needs three distinct humans; self-approval and checker activation are refused                                       |
| S01 | A SANDBOX database is refused before any CP call; the operator moves it to ENFORCED, which cannot be undone                     |
| S02 | Store HTTP checkout commits one order; receipt, commitment and CP decision (binding, mandate, activity) agree                   |
| S03 | A checkout replay returns the same order and no second commitment                                                               |
| S04 | A direct `completeCartWorkflow` run reaches the same PEP and outcome                                                            |
| S05 | Draft finalisation without a `DRAFT_ORDER_FINALISATION` mandate is a recorded CP denial                                         |
| S06 | With its mandate, Admin HTTP finalisation commits under a current CP decision                                                   |
| S07 | A direct `convertDraftOrderWorkflow` run is refused at persistence                                                              |
| S08 | Direct and admin order creation stay denied (`NO_GOVERNED_COMMIT_POINT`, 403)                                                   |
| S09 | Trade's runtime role cannot insert an order, complete a cart, consume or rewrite receipts and commitments, or downgrade posture |
| S10 | Trade-B/C mutations are denied by name for an authenticated administrator; no credential is 401                                 |
| S11 | A suspended binding denies checkout; operator reinstatement restores it                                                         |
| S12 | Native configuration drift is refused before any CP decision                                                                    |
| S13 | CP unavailable answers 503 (retryable) and commits nothing; the same cart completes when CP returns                             |
| S14 | A disabled TA-07 fence trigger is detected (`FENCE_NOT_ACTIVE`) and refused before any CP call                                  |
| S15 | A revoked mandate denies checkout, recorded by CP as `REVOKED_OR_EXPIRED`                                                       |
| S16 | Every commitment consumed exactly one receipt matching an AUTHORIZED CP decision; no order lacks a commitment                   |

The runner also fails if any service log carries a token or a run secret.

**Local run, 21 October 2026.** Trade `afa1301` and CP `3810b82` passed 18 of
18 scenarios (`Trade-A failures: 0`). The run used a local image variant that
adds the session's egress CA and skips `apk upgrade`, which the environment's
network policy blocks; the application layers are identical. CI job
`trade-a-real-cp` builds the unmodified `Dockerfile` and is the evidence of
record.

## Residual risk (stated, not hidden)

- **Table owner.** The role that owns the native tables can still `ALTER`
  them, for example to disable a trigger between two checks. The posture check
  detects a disabled trigger at the next operation, but it does not prevent
  one. Separating the migration owner from the runtime role is a
  protected-staging control.
- **Raw-SQL replay inside the lease.** This carries over from TA-07, unchanged.
- **Fixtures.** Payment sessions are Trade-C and stay denied over HTTP, so the
  harness creates carts' `pp_system_default` sessions and drafts at module
  level, as an import would.

## Protected-staging deployment contract

The harness had to establish each of these. Protected staging must provide
them, and none exists in `infrastructure` today.

1. **Profile.** The image sets `NODE_ENV=production`, which Trade-A treats as
   production (always denied). A protected Trade runtime must set
   `NODE_ENV=staging` with `BAOBAB_ENVIRONMENT=staging`. Production
   infrastructure modules (Redis event bus, S3 files) are keyed on
   `NODE_ENV=production`, so staging cannot have both today. That needs an
   owner decision before protected staging.
2. **Enablement.** Set `BAOBAB_TRADE_A_ORDER_AUTHORITY_ENABLED=true`, plus the
   CP base URL, engine instance and IAM workload client.
3. **Database.** Migrate under the protected profile (posture `ENFORCED`), or
   move a SANDBOX posture to ENFORCED as an operator step. Use a non-superuser
   runtime role. Allow headroom for Medusa's per-module pools: about 100
   connections during `db:migrate`, and the superuser-reserved slots are not
   available to that role. Use TLS to the database, or an explicit `sslmode`:
   Medusa's migration lock connection requests SSL for any non-local host.
4. **Migrations.** The shipped image's non-root user cannot run `db:migrate`,
   because Medusa creates empty `migrations` folders inside provider packages.
   The harness runs only that one-off as root. The image should be fixed
   separately.
5. **Workload.** The canonical
   `baobab-trade-legal-actor-assessor-staging` entry is PROVISIONED in Shared.
   Activating it is a separate, approved change.

## Rollback

- **Immediate:** unset `BAOBAB_TRADE_A_ORDER_AUTHORITY_ENABLED`. The PEP then
  denies every class (`PROTECTED_RUNTIME`).
- **Code:** revert this change. `PERSISTENCE_FENCED_CLASSES` is then empty
  again, and TA-06 denies both classes in protected runtimes.

No migration is added, so nothing is rolled back in a database.

## Remaining

Real mandates, bindings, IAM and workload admission remain external, as do
protected staging and Gate E. Trade-B, Trade-C and Trade-D stay out of scope.
