# P0-04B-01 — Durable Trade seller-binding lifecycle

Date: 13 October 2026. First bounded P0-04B implementation set, following the five
P0-04A consumer slices. Authority: Accepted ADR-BCP-026/027 LA-05, Trade ADR-0008,
ADR-0009, ADR-0010 and ADR-0014. This is local lifecycle/storage enforcement,
not workload admission, legal-actor approval or live checkout certification.

## Audit and sequence

Trade baseline `1eaddb9a67fbd05b56311b1dc22e8efe151d0ab4`; CP
`778958615aee984c1a933039114dc4ce0a19a5c5`; Shared
`a9c53087d63caa356edf54ec8037ba1713c4827f`; IAM
`ad7989ca085831303c265f943ef2b97735f911ad`. All eight audited repositories had
no open PRs at this task's audit. Older Trade branches remain historical;
`feat/la-05c3-trusted-native-cart-runtime` diverges from main, whose current
LA-05C3–C8 and P0-04A implementations are reused rather than overwritten.

| Owner         | Audited main                               | Remaining P0-04B boundary                                                                                         |
| ------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Trade         | `1eaddb9a67fbd05b56311b1dc22e8efe151d0ab4` | Durable binding lifecycle, authenticated issuance/revocation, current CP context, protected native checkout proof |
| ERP           | `4b7e9ef7a8877543910fc15578c787a67a788f18` | Trusted native context/readiness providers and atomic financial posting acceptance                                |
| Payments      | `f065ddaf9dc141aba222f74f8b2481b8f2e877f0` | Protected authenticated money lifecycle, qualified merchant/provider and native acceptance                        |
| Subscriptions | `52c69906343d7b1afee08a88b8d3afe118af0428` | Invoice responsibility and protected billing/provider handoff                                                     |
| Trade Docs    | `73cd1c168be39305c2e238b1f0a5b72da7821539` | Actual context-bound immutable version/signing/outbox runtime                                                     |

The installed native cart completion hook already rechecks the current binding,
CP legal actor, documentary veto and independent Payments readiness. The C5
proposal/approval/revocation adapter remained uncomposed, its decision/outbox DDL
was documentation only, and approval never activated its placeholder context.
The first set installs that durable lifecycle and closes its snapshot, expiry
and audit bypasses. **P0-04B as a whole remains open.**

## Implementation and authority

The legal-seller module now always installs its empty storage schema through
`medusa db:migrate`. It constructs neither CP/IAM/Payments clients nor their
credentials during ordinary module loading. Protected checkout dependencies are
lazy and require the existing explicit guard and a recognised non-production
profile. Production/unknown checkout still denies. The internal persistence port
uses the trusted runtime DATABASE_URL with bounded connection/lock/statement
waits and closes its pool through the module shutdown hook.

`Migration20261013130000` adds an immutable proposal snapshot, revision,
append-only decisions and local unpublished candidate audit records. No canonical
event producer, relay or publication claim is added. Deferred database receipts
require the matching decision and audit record for each committed revision.
Direct generated CRUD, missing receipts, rewritten business/approval provenance,
physical/soft deletion, replay and an update/insert to ACTIVE are rejected.

New records remain PROPOSED with deliberately unresolved context/activity fields.
Approval remains PROPOSED; no CP-owned RUNTIME handle is fabricated and no local
approval becomes a legal mandate. Legacy rows are not silently given snapshots:
legacy PROPOSED rows cannot be approved; existing ACTIVE rows are not retroactively
certified or rewritten, and can be revoked with the required audit receipt.
Activation requires a later explicit, governed implementation/migration.

The command policy checks each required scope key (an omitted property no longer
escapes Object.values validation), exact array-valued command scopes and actual
calendar timestamps. The command service rechecks the current human identity and
command scope plus CP context after evidence I/O, and rechecks expiry/evidence
freshness with a callable current clock. A revoked legal mandate does not become
a prerequisite for withdrawing a local binding. These ports remain candidate
interfaces; no invented IAM/evidence gateway or human mutation endpoint is enabled.

## Transaction and maintenance invariants

1. Take the cart advisory transaction fence before the row lock on every mutation;
   an absent row cannot itself be locked to serialize duplicate proposals.
2. Use the stored scope and full proposal JSONB, including original maker,
   timestamp, expiry and evidence reference. An approval request is not a replacement
   source of facts.
3. Compare expiry to `clock_timestamp()` after waits and audit I/O, and again in
   the deferred receipt trigger at COMMIT. Transaction time remains fixed at BEGIN.
4. Commit row revision, decision and local audit record together; failure rolls all
   three back. Audit records are append-only and candidates stay unpublished.
5. Do not reissue a revoked/deleted cart or change its immutable seller/tenant scope.
6. Never turn an inactive approval into ACTIVE through the generated SDK.

Rollback of this migration refuses to drop non-empty decision history. A rollback
with records requires an independently reviewed preservation/restore plan. Empty
schema rollback is allowed. Keep checkout closed during rollback; reverting code
is not revocation of a CP mandate or a licence to use an unguarded production path.

## Validation

`npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`,
`BAOBAB_SHARED_PATH=/exact/shared/checkout npm run test:shared-conformance`, and
`npm run build` validate the local source, existing boundaries and packaged schema
provenance. Unit tests cover omitted scope fields, invalid calendars, expiry during
evidence I/O, changed IAM authority and stale evidence. Source test discovery now
excludes generated build copies by selecting only source directories; building
before testing no longer imports CJS copies of Vitest tests.

Hosted CI applies the real Medusa migrations to disposable PostgreSQL 17, then
runs `npm run regression:governed-binding-lifecycle` with
`BAOBAB_BINDING_LIFECYCLE_TEST_DB=baobab_trade_test` and NODE_ENV=test. The script
refuses an unmarked/non-test database. It uses the actual module read/persistence
paths and verifies proposal/approval/revocation, immutable snapshots and provenance,
concurrent duplicate proposals/approvals, approval versus revocation, direct
activation/audit bypass denial, lock-wait expiry, audit-insertion expiry and deferred pre-COMMIT expiry rollback.
Fixtures use explicitly synthetic identities/evidence and stay inactive. Append-only
receipts remain until CI disposes the database. This proves native storage behavior,
not current IAM/CP/legal/provider authority or successful checkout. Local PostgreSQL
and Docker binaries are unavailable; hosted proof is mandatory before merge.

## Next bounded set and external acceptance

**P0-04B-02:** authenticate binding command intake using actual approved Shared/IAM
vocabulary; bind the proposed native cart/region/channel to a CP-issued owned RUNTIME
context and current legal actor; implement independently approved, versioned activation
and revocation without replacing history. Current `trade:legal-seller-binding:*`
strings are local candidate scopes, absent from Shared's registry. Do not grant
or silently register them or treat the candidate HTTP gateways as deployed authority.

Then complete protected native checkout/replay/revocation proof, independent qualified
merchant readiness and workload admission, followed by the ERP, Payments,
Subscriptions and Trade Docs boundaries above. Genuine P0-03 corporate/control/mandate
records and protected operational evidence remain outstanding. No positive synthetic
fixture can stand in for these decisions.

## Primary implementation references

- [Medusa module migrations](https://docs.medusajs.com/learn/fundamentals/data-models/write-migration)
- [Medusa database commands](https://docs.medusajs.com/resources/medusa-cli/commands/db)
- [PostgreSQL 17 row locking](https://www.postgresql.org/docs/17/explicit-locking.html)
- [PostgreSQL 17 current versus transaction clocks](https://www.postgresql.org/docs/17/functions-datetime.html)
- [Vitest source include patterns](https://vitest.dev/config/include)
