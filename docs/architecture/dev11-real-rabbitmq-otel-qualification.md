# DEV-11 — genuine Medusa outbox → RabbitMQ → ERP PostgreSQL inbox

**Status:** Engineering implementation in Trade #188; **L4-OPS-01 BLOCKED**
until final-head running CI and actual authorised iDempiere consequences are
independently observed. No staging/production approval or PR merges.

## Ownership and native boundaries

### 4 November 2026 — publisher crash recovery correction

Run `41602184493` reached genuine confirmed publication and the simulated
publisher process crash, then aborted with `KeyError: 0`. The Trade PostgreSQL
connection returns named dictionary rows; the lease-expiry probe mistakenly
used a positional index. `publisher_lease_expired` now reads the named result
from PostgreSQL's own clock and requires boolean true. Absent rows and NULL
leases cannot qualify recovery. Its unit regression covers all four outcomes;
the unchanged real broker workflow must still prove reclaim, redelivery and
deduplication at the new source. No test rewrites the lease timestamp.

This corrects the component qualification runner, not the outstanding governed
Medusa buyer order or native iDempiere business consequence. L4-OPS-01 stays
BLOCKED. Do not interpret a source-test pass as observed broker recovery.

The **Trade-owned** Medusa event-outbox module remains the authority for
`event_outbox` persistence, original event/semantic digest, idempotency and
the per-record lease. The new separately executable Trade-owned
`scripts/dev11_rabbit_dispatcher.py` _only_ dispatches rows already committed
by that Medusa module. Its Python 3.14 packaging is explicit and isolated from
the Node24 Medusa compatibility/dependency lock. No order creation, tenant
grant, or iDempiere database mutation originates from this worker.

The publisher:

1. Selects registered canonical fact types, claims a due PostgreSQL row with
   `FOR UPDATE SKIP LOCKED`, lease and attempt fence.
2. Validates the immutable event identity before signing its complete original
   JSON envelope with a run-owned HMAC key. Event identity and original
   `traceparent` remain stable under redelivery.
3. Uses a durable, pre-provisioned RabbitMQ topic exchange and persistent
   messages with `mandatory=True` and publisher confirmations. No
   unconfirmed or unroutable send may mark `PUBLISHED`.
4. Records confirmed published/retry/dead-letter outcomes in the owning
   PostgreSQL row with the same attempt/lease fence; ambiguous broker
   confirmation becomes retryable. Exactly-once **transport** is not claimed.
5. Exports real official Python OTel PRODUCER spans with a W3C parent and
   link from the persisted signed event. Diagnostic result attributes use
   fixed vocabulary; event payloads, headers, secrets, SQL and names are
   never attached.

**Single-dispatcher selection:** A runtime operator must explicitly select
`BAOBAB_EVENT_DISPATCH_BACKEND=rabbitmq-confirmed`. The original
`AtLeastOnceOutboxDispatcher` remains an alternative component tested by
the existing PostgreSQL failure suite, but both must never concurrently
own the same production event stream. A deployment gate must prove this
mutual exclusion before enabling a protected environment.

## Native connected development qualification

Workflow `.github/workflows/dev11-rabbit-connected.yml` provisions a
disposable real PostgreSQL 17, Redis, RabbitMQ 4.3 quorum queue and DLX, and
a real Collector + Jaeger trace backend. It checks out immutable Trade,
ERP #125 and Infrastructure #72 sources.

`src/scripts/prepare-dev11-rabbit-event.ts` exercises the real Medusa
event-outbox module and locking. It creates a **synthetic signed canonical
test event**, NOT a committed IAM/CP-authorised order. The original
`traceparent` identifies a recorded and flushed native OTel event source
span; no invented unexported spans are accepted as evidence.

`scripts/dev11_rabbit_connected.py` uses the native Trade publisher and
**a separate ERP application process**, never an in-process ERP callback,
to prove these connected properties:

- Broker-confirmed durable publication; owner outbox `PUBLISHED` record
  and attempt count agree with RabbitMQ.
- A test-only independent ERP consumer exits after real PG inbox admission
  and before broker ACK; the actual RabbitMQ connection disappears.
- A fresh production-path ERP consumer handles that genuine redelivery,
  acknowledges it, and preserves exactly one `(source,event_id)` PG receipt.
  Broker manual ACK counters are independently read over the loopback-only
  RabbitMQ management API; a mere absence of READY messages is insufficient.
- A second deliberate duplicate delivery remains idempotent; a correctly
  signed changed business payload and a forged signature both go to the
  pre-provisioned DLQ without replacing the durable receipt.
- Mandatory unroutable publication raises a broker negative; a confirmation
  without a route never counts as a successful consumer delivery.
- Official SDK spans from native Medusa source, Trade AMQP publisher and
  independently running ERP receiver reach a private Collector and Jaeger.
  Infrastructure #72's independently sourced verifier queries the Jaeger v3
  trace API and validates actual exported service/span parentage. This is
  separate from the stored event, runtime stdout and source-only graphs.

Every product of this run is **component qualification only**:
`native_erp_business_effect_qualified=false`, `l4_ops_01=BLOCKED` and
`production_authorized=false`. Source SHAs are independently recorded;
raw trace IDs never enter uploaded GitHub artifacts.

## Failure/authority work remaining

Trade #188 must not be merged until its current-head CI (including this
real broker profile and the existing core Medusa PG suite) passes review.
The known existing Medusa `qualify:dev11-outbox-native` failure-path test
remains distinct: it proves durable retry/dead-letter for a deliberately
unavailable publisher, not RabbitMQ delivery.

**The complete L4-OPS-01 vertical is still incomplete:** a real authenticated
BFF→IAM→CP authorised commitment must create the _same_ native Trade
business fact and outbox event; real ERP inbound and a running iDempiere 13
must exercise current actor/market/mandate checks, native POReference adoption,
a genuine engine effect, second-company isolation, and crash/replay
reconciliation. Only after that can Infrastructure's independent seven-run
evidence join be reconciled with Nabhold/ZuriBeans/Thamani
Playwright/a11y/visual/performance and immutable teardown. No synthetic
order event or broker ACK is a native iDempiere posting.

## 4 November 2026 — native business origin gate (source qualification)

A real exported W3C trace and a confirmed RabbitMQ delivery are **necessary but
insufficient** to claim a buyer-authorised Trade order. A separate,
read-only Python 3.14 verifier now lives at
`scripts/dev11_native_business_origin.py`.

Before any dispatch, it reads a single repeatable-read PostgreSQL 17 snapshot
and requires the existing owner-created native Medusa `order` row, a matching
`trade_order_commitment` seller receipt consumed inside the native commit
trigger, the uniquely associated `trade_commit_fence_decision` with
`commerce_model=B2B`, `outcome=ALLOWED`, `enforcement_mode=ENFORCED`,
the ACTIVE scoped buyer Organisation/membership classification, and actual
`b2b_spend_ledger_entry` COMMIT rows for the same order, with active committed
reservations and exact membership/Organisation. The outbox, commitment, deferred
fence verdict and spend conversion must carry the same originating PostgreSQL
insert transaction ID, read _before_ the dispatcher updates the outbox. An
envelope ID, trace, CP-like string or HMAC signature is never an alternative.

That condition **cannot pass under the accepted Trade SQL**: the active
CAA-06b implementation has not yet replaced the explicit
`BUYER_AUTHORITY_ABSENT` outcome for every B2B order; its enforcement
remains `SHADOW`. This is an intentional acceptance blocker, not a test to
skip or loosen. No new API, worker ability, credential, role, or activation
was granted by the verifier.

The real RabbitMQ workflow runs the verifier after its actual migrated
Medusa outbox fixture is created, and **before** publishing it.
`--expect-synthetic-refusal` demands the precise
`NATIVE_ORDER_ABSENT` refusal from a real PostgreSQL readback; missing
migrations, empty fixture, network outage and any purported native success
all fail the test. Unit regressions additionally deny foreign event identity,
changed idempotency, forged trace context, `SHADOW`/absent buyer authority and
missing tables. Its sanitized `native-origin.json` receipt expressly sets
`current_iam_cp_authority_qualified=false`,
`native_erp_business_effect_qualified=false`, `l4_ops_01=BLOCKED`.

Future CAA-06b work MUST replace the native deferred B2B refusal only after a
server-issued final valuation, current human IAM/CP buyer operation ALLOW,
non-self-approved approvals, current membership revision, one immutable buyer
receipt and same-transaction seller/buyer receipt consumption and ledger
conversion. The Medusa order and its canonical `trade.order.placed` outbox
must be created in that _same_ database transaction. Retain negative tests
for wrong audience, market/Site, changed quotation, price/tax/freight,
revocation, duplicate order, stale hold, insufficient budget, seller withdrawal,
broker ambiguity and ERP-native posting veto.

The read-only source checker is not itself current IAM/CP approval. Even a
future `NATIVE_ORIGIN_SQL_READBACK_ONLY` positive must be joined by an
independently issued current CP/IAM readback, the **same** event/trace in the
real ERP #125 iDempiere13 business-effect run, and an Infrastructure #72
independent source/trace/replay/teardown join before L4-OPS-01 is accepted.
A later outbox publish changes its `xmin`; preserve the pre-dispatch original
source receipt and source-specific digest in the private run custody.

### Synthetic selector correction following run 41841700520

The native-origin step at source `007eab655adf102c8dc3ee063d86431fc53efe85`
failed with `NATIVE_ORIGIN_DATABASE_UNAVAILABLE` before it could inspect the
synthetic order. The selector embedded a literal `%` in its SQL `LIKE` pattern
while also supplying psycopg parameters. Psycopg interpreted that percent as an
invalid placeholder; reproducing the driver parser locally confirmed the error
without a database. The full prefix pattern is now a bound value, following
[psycopg's parameter rules](https://www.psycopg.org/psycopg3/docs/basic/params.html).

The regression executes the CLI selector through psycopg's actual parameter
parser; the mock supplies only subsequent rows. Separate regressions retain
failures for missing schema, unavailable readback and an unqualified B2B fence.
Only `NATIVE_ORDER_ABSENT` satisfies the synthetic negative. These are source
regressions; the new Python 3.14/PostgreSQL 17 Actions run must independently
observe that refusal before any RabbitMQ dispatch. No native buyer order,
current IAM/CP authority or L4-OPS-01 acceptance is inferred from this fix.
