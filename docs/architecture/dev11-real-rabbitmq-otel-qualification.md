# DEV-11 — genuine Medusa outbox → RabbitMQ → ERP PostgreSQL inbox

**Status:** Engineering implementation in Trade #188; **L4-OPS-01 BLOCKED**
until final-head running CI and actual authorised iDempiere consequences are
independently observed. No staging/production approval or PR merges.

## Ownership and native boundaries

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
