# DEV-07 spend and database mutation composition

`PostgresSpendReservationCommands.commitWithMutation` executes the existing
checked reservation conversion and a trusted owner's database mutation on one
connected PostgreSQL transaction. The query interface is bound to that
connection and does not expose release. The mutation must use it for every
database write, must not begin/commit/rollback independently and must not perform
external side effects. No HTTP request supplies a callback or database access.

The command result is persisted after the mutation. Callback failure, a database
error or a deferred constraint failure at COMMIT rolls back the mutation,
reservation status, all budget ledger entries and the idempotency result.
A successful replay returns the original result and does not execute the mutation
again. Its request digest is distinguished from capacity-only COMMIT commands:
neither API can falsely replay the other's result under the same key.

This is a transaction composition primitive, **not a qualified native buyer
commit fence**. It installs no buyer receipt, trusts no browser valuation, does
not adapt a Medusa workflow that opens its own transaction and activates no
enforcement gate. The future native mutation must consume matched buyer and
seller receipts, validate authoritative gross valuation, current membership and
hold revision, and pass the deferred database fence in this same transaction.
A caller that ignores the supplied connection has not implemented atomicity.

The existing disposable PostgreSQL 17 regression exercises successful composition,
an application error after a write, a deferred constraint error at COMMIT, clean
retry and duplicate replay. Native MVCC transaction IDs independently establish
that the probe mutation, reservation status, ledger and command record came from
one transaction. The probe is explicitly a test table, not an order, authority
receipt or provider acceptance result. Existing native fence and TA-08 regressions
remain mandatory and their historical acceptance scope is unchanged.
