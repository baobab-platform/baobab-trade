/**
 * DEV-11 native PostgreSQL failure-diagnosis and replay qualification.
 * Actually invokes Medusa's EventOutboxModuleService, native locking, and
 * AtLeastOnceOutboxDispatcher. Deliberately has NO successful broker adapter,
 * ERP effect or consumer receipt; an unavailable broker must reach a durable
 * retry and then DEAD_LETTER. Never counted as completed external delivery.
 */
import { randomUUID } from "node:crypto"
import type { ExecArgs, ILockingModule } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  AtLeastOnceOutboxDispatcher,
  TransactionalOutbox,
  type OutboxRepository,
  createTenantTradeEvent,
  isValidCloudEvent,
  reconcileOutboxRecord,
} from "../baobab/events"
import { EventOutboxRecordAdapter } from "../baobab/events/outbox-record-adapter"
import type EventOutboxModuleService from "../modules/event-outbox/service"

const ensure = (value: unknown, code: string): void => {
  if (!value) throw new Error(code)
}

export default async function ({ container }: ExecArgs): Promise<void> {
  if (process.env.NODE_ENV !== "test" || process.env.BAOBAB_ENVIRONMENT === "production")
    throw new Error("DEV11_ISOLATED_TEST_RUNTIME_REQUIRED")
  const service = container.resolve<EventOutboxModuleService>("eventOutbox")
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const repository = new EventOutboxRecordAdapter(service, locking)
  const outbox = new TransactionalOutbox(repository)
  const eventId = randomUUID()
  const correlation = randomUUID()
  const sourceTrace = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
  const event = createTenantTradeEvent(
    {
      tenantId: "tenant-dev11-synthetic",
      entityId: "canonical:legal-entity:dev11-synthetic",
      lifecycleStatus: "active",
      productId: "baobab-trade",
      entitled: true,
      entitlementTier: null,
      cacheTtlSeconds: 10,
      resolvedAt: new Date().toISOString(),
      correlationId: correlation,
    },
    {
      id: eventId,
      type: "com.baobab-platform.trade.order.placed.v1",
      subject: "commerce-order/dev11-test",
      time: new Date().toISOString(),
      dataschema:
        "https://contracts.baobab-platform.com/erp/v1/commerce-order-consequence.schema.json",
      correlationid: correlation,
      causationid: randomUUID(),
      idempotencykey: "dev11-native-pg:" + eventId,
      traceparent: sourceTrace,
      data: {
        canonical_entity_id: "canonical:order:dev11-test",
        commerce_reference: "dev11-test",
        projection_kind: "ORDER",
        projection_status: "PENDING",
      },
    },
  )
  ensure(isValidCloudEvent(event), "DEV11_EVENT_CONTRACT_INVALID")
  // The canonical event type allows the optional property, but the native
  // outbox requires a nonempty authoritative idempotency key in every lookup.
  const idempotencyKey = event.idempotencykey
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0)
    throw new Error("DEV11_EVENT_IDEMPOTENCY_KEY_REQUIRED")
  const created = await outbox.enqueue(event)
  try {
    const persisted = await repository.findByIdempotencyKey(idempotencyKey)
    ensure(
      persisted?.eventId === eventId && persisted.envelope.traceparent === sourceTrace,
      "DEV11_POSTGRES_TRACE_PROVENANCE_MISSING",
    )
    const replay = await outbox.enqueue(event)
    ensure(replay.id === created.id, "DEV11_EXACT_REPLAY_NOT_IDEMPOTENT")

    // New legitimate request traces must never duplicate the event.
    const newTrace = await outbox.enqueue({
      ...event,
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-1111111111111111-01",
    })
    ensure(newTrace.id === created.id, "DEV11_TRACING_CHANGED_BUSINESS_IDEMPOTENCY")
    let alteredPayloadDenied = false
    try {
      await outbox.enqueue({
        ...event,
        data: { ...event.data, projection_status: "ACCEPTED" },
      })
    } catch {
      alteredPayloadDenied = true
    }
    ensure(alteredPayloadDenied, "DEV11_CONFLICTING_BUSINESS_REPLAY_ADMITTED")

    let publisherCalls = 0
    const publisher = {
      publish: async () => {
        publisherCalls++
        throw new Error("DEV11_BROKER_UNAVAILABLE")
      },
    }
    // A real PostgreSQL adapter owns all state mutations. Narrow only the
    // run's due-list discovery so this test NEVER dispatches another test's
    // real pending event or misrepresents its provider outcome.
    const owned: OutboxRepository = {
      findByIdempotencyKey: (key) => repository.findByIdempotencyKey(key),
      create: (message, key) => repository.create(message, key),
      listDue: async (now, limit) => {
        if (limit < 1) return []
        const row = await repository.findByIdempotencyKey(idempotencyKey)
        if (!row) return []
        const due =
          ((row.status === "PENDING" || row.status === "RETRY") && row.nextAttemptAt <= now) ||
          (row.status === "PUBLISHING" &&
            row.leaseExpiresAt !== undefined &&
            row.leaseExpiresAt <= now)
        return due ? [row] : []
      },
      claim: (id, now, attempt, expiry) => {
        ensure(id === created.id, "DEV11_FOREIGN_OUTBOX_CLAIM_REFUSED")
        return repository.claim(id, now, attempt, expiry)
      },
      markPublished: () => {
        throw new Error("DEV11_NO_REAL_BROKER_SUCCESS")
      },
      markRetry: (id, when, cause) => {
        ensure(id === created.id, "DEV11_FOREIGN_RETRY_REFUSED")
        return repository.markRetry(id, when, cause)
      },
      markDeadLetter: (id, cause) => {
        ensure(id === created.id, "DEV11_FOREIGN_DEAD_LETTER_REFUSED")
        return repository.markDeadLetter(id, cause)
      },
    }
    const dispatcher = new AtLeastOnceOutboxDispatcher(owned, publisher, {
      maxAttempts: 2,
      initialDelayMs: 1,
      maxDelayMs: 1,
      leaseDurationMs: 1_000,
    })
    const start = new Date(Date.now() + 30_000)
    const first = await dispatcher.dispatchDue(start)
    const retried = await repository.findByIdempotencyKey(idempotencyKey)
    ensure(
      first.some((row) => row.id === created.id && row.status === "RETRY") &&
        retried?.status === "RETRY" &&
        retried.attemptCount === 1,
      "DEV11_POSTGRES_RETRY_NOT_DURABLE",
    )

    const second = await dispatcher.dispatchDue(new Date(start.getTime() + 2_000))
    const terminal = await repository.findByIdempotencyKey(idempotencyKey)
    ensure(
      second.some((row) => row.id === created.id && row.status === "DEAD_LETTER") &&
        terminal?.status === "DEAD_LETTER" &&
        terminal.attemptCount === 2 &&
        terminal.envelope.traceparent === sourceTrace &&
        reconcileOutboxRecord(terminal).status === "ACTION_REQUIRED" &&
        publisherCalls === 2,
      "DEV11_FAILURE_DIAGNOSIS_NOT_DURABLE",
    )

    // Receipt deliberately records failure-mode assertions, never a delivery.
    container
      .resolve("logger")
      .info(
        "DEV11_REAL_POSTGRES_OUTBOX_REPLAY_RETRY_DEAD_LETTER_PASS; " +
          "BROKER_SUCCESS_NOT_OBSERVED; CONSUMER_EFFECT_NOT_OBSERVED; " +
          "PROTECTED_ACCEPTANCE_FALSE",
      )
  } finally {
    // Disposable development database; no domain business record is modified.
    await service.deleteEventOutboxes([created.id])
  }
}
