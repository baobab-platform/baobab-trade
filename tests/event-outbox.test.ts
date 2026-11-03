import { canonicalEventFingerprint } from "../src/baobab/events/outbox"
import { enterHttpTrace } from "../src/baobab/observability/tracing"
import { describe, expect, it } from "vitest"
import {
  AtLeastOnceOutboxDispatcher,
  IdempotentEventConsumer,
  NoopEventPublisher,
  TransactionalOutbox,
  createTenantTradeEvent,
  reconcileOutboxRecord,
  type BaobabCloudEvent,
  type ConsumerReceipt,
  type ConsumerReceiptRepository,
  type OutboxRecord,
  type OutboxRepository,
} from "../src/baobab/events"

const context = {
  tenantId: "tenant-zuribeans",
  entityId: "canonical:legal-entity:zuribeans",
  lifecycleStatus: "active" as const,
  productId: "baobab-trade",
  entitled: true as const,
  entitlementTier: null,
  cacheTtlSeconds: 60,
  resolvedAt: "2026-09-08T00:00:00.000Z",
  correlationId: "11111111-1111-4111-8111-111111111111",
}
const event = createTenantTradeEvent(context, {
  id: "22222222-2222-4222-8222-222222222222",
  type: "com.baobab-platform.trade.order.placed.v1",
  subject: "commerce-order/gate13-order",
  time: "2026-09-08T00:00:00.000Z",
  dataschema: "https://contracts.baobab-platform.com/erp/v1/commerce-order-consequence.schema.json",
  correlationid: context.correlationId,
  causationid: "33333333-3333-4333-8333-333333333333",
  idempotencykey: "gate13:order:accepted",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  data: { order_reference: "gate13-order", currency: "UGX", total_minor: 1250000 },
})

class MemoryOutbox implements OutboxRepository {
  records: OutboxRecord[] = []
  async findByIdempotencyKey(key: string) {
    return this.records.find((x) => x.idempotencyKey === key)
  }
  async create(envelope: BaobabCloudEvent, key: string) {
    const record: OutboxRecord = {
      id: `out-${this.records.length + 1}`,
      eventId: envelope.id,
      eventType: envelope.type,
      subject: envelope.subject,
      tenantId: envelope.baobabscope === "tenant" ? envelope.tenantid : undefined,
      correlationId: envelope.correlationid,
      causationId: envelope.causationid,
      idempotencyKey: key,
      envelope,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: new Date(0),
    }
    this.records.push(record)
    return record
  }
  async listDue(now: Date, limit: number) {
    return this.records
      .filter((x) => ["PENDING", "RETRY"].includes(x.status) && x.nextAttemptAt <= now)
      .slice(0, limit)
  }
  async claim(id: string, now: Date, attemptCount: number, leaseExpiresAt: Date) {
    const current = this.records.find((item) => item.id === id)
    if (!current || !["PENDING", "RETRY"].includes(current.status) || current.nextAttemptAt > now)
      return undefined
    return this.patch(id, { status: "PUBLISHING", attemptCount, leaseExpiresAt })
  }
  async markPublished(id: string, publishedAt: Date) {
    return this.patch(id, { status: "PUBLISHED", publishedAt })
  }
  async markRetry(id: string, nextAttemptAt: Date, lastErrorCode: string) {
    return this.patch(id, { status: "RETRY", nextAttemptAt, lastErrorCode })
  }
  async markDeadLetter(id: string, lastErrorCode: string) {
    return this.patch(id, { status: "DEAD_LETTER", lastErrorCode })
  }
  private patch(id: string, values: Partial<OutboxRecord>) {
    const item = this.records.find((x) => x.id === id)
    if (!item) throw new Error("missing")
    Object.assign(item, values)
    return item
  }
}

describe("transactional event outbox", () => {
  it("enqueues canonical events idempotently and preserves tracing", async () => {
    const repository = new MemoryOutbox()
    const outbox = new TransactionalOutbox(repository)
    expect((await outbox.enqueue(event)).id).toBe((await outbox.enqueue(event)).id)
    expect(repository.records).toHaveLength(1)
    expect(repository.records[0].envelope.causationid).toBe(event.causationid)
    expect(repository.records[0].envelope.traceparent).toBe(event.traceparent)
  })
  it("publishes at least once and exposes retry/dead-letter reconciliation", async () => {
    const repository = new MemoryOutbox()
    await new TransactionalOutbox(repository).enqueue(event)
    await new AtLeastOnceOutboxDispatcher(repository, new NoopEventPublisher()).dispatchDue(
      new Date(),
    )
    expect(repository.records[0].status).toBe("PUBLISHED")
    expect(reconcileOutboxRecord(repository.records[0]).status).toBe("MATCHED")
    const failing = new MemoryOutbox()
    await new TransactionalOutbox(failing).enqueue(event)
    await new AtLeastOnceOutboxDispatcher(
      failing,
      {
        publish: async () => {
          throw new Error("broker down")
        },
      },
      { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, leaseDurationMs: 1 },
    ).dispatchDue(new Date())
    expect(reconcileOutboxRecord(failing.records[0]).status).toBe("ACTION_REQUIRED")
  })
  it("deduplicates consumer delivery by consumer and event id", async () => {
    const receipts = new Map<string, ConsumerReceipt>()
    let effects = 0
    const repository: ConsumerReceiptRepository = {
      find: async (consumer, eventId) => receipts.get(`${consumer}:${eventId}`),
      processAtomically: async (consumer, input, handler) => {
        await handler(input)
        const receipt = {
          id: "receipt-1",
          consumerName: consumer,
          eventId: input.id,
          eventType: input.type,
          correlationId: input.correlationid,
          processedAt: new Date(),
        }
        receipts.set(`${consumer}:${input.id}`, receipt)
        return receipt
      },
    }
    const consumer = new IdempotentEventConsumer(repository)
    expect(
      (
        await consumer.consume("idempiere-order", event, async () => {
          effects += 1
        })
      ).duplicate,
    ).toBe(false)
    expect(
      (
        await consumer.consume("idempiere-order", event, async () => {
          effects += 1
        })
      ).duplicate,
    ).toBe(true)
    expect(effects).toBe(1)
  })
})

describe("DEV-11 persisted event and native replay correlation", () => {
  it("preserves original event structure/digest when no W3C context exists", () => {
    const legacy = createTenantTradeEvent(context, {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      type: "com.baobab-platform.trade.order.placed.v1",
      subject: "commerce-order/dev11-legacy",
      time: "2026-09-08T00:00:00.000Z",
      dataschema:
        "https://contracts.baobab-platform.com/erp/v1/commerce-order-consequence.schema.json",
      correlationid: context.correlationId,
      idempotencykey: "dev11-legacy",
      data: { order_reference: "dev11-legacy", currency: "UGX", total_minor: 100 },
    })
    expect(Object.hasOwn(legacy, "traceparent")).toBe(false)
    expect(canonicalEventFingerprint(legacy)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("attaches one W3C trace to the event at original business creation", () => {
    const logged = console.info
    console.info = () => undefined
    try {
      let emitted: BaobabCloudEvent | undefined
      enterHttpTrace("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", () => {
        emitted = createTenantTradeEvent(context, {
          id: "22222222-2222-4222-8222-222222222222",
          type: "com.baobab-platform.trade.order.placed.v1",
          subject: "commerce-order/gate13-order",
          time: "2026-09-08T00:00:00.000Z",
          dataschema:
            "https://contracts.baobab-platform.com/erp/v1/commerce-order-consequence.schema.json",
          correlationid: context.correlationId,
          idempotencykey: "gate13:order:accepted",
          data: { order_reference: "gate13-order", currency: "UGX", total_minor: 1250000 },
        })
      })
      expect(emitted?.traceparent).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/)
      expect(emitted?.correlationid).toBe(context.correlationId)
    } finally {
      console.info = logged
    }
  })

  it("redelivers one business effect across changed trace metadata", async () => {
    const logger = console.info
    console.info = () => undefined
    try {
      const repository = new MemoryOutbox()
      const original = await new TransactionalOutbox(repository).enqueue(event)
      const retried = {
        ...event,
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-1111111111111111-01",
      }
      // Distinct transport W3C must not create a second business effect,
      // but the first immutable stored canonical envelope digest is unchanged.
      expect((await new TransactionalOutbox(repository).enqueue(event)).id).toBe(original.id)
      expect(canonicalEventFingerprint(retried)).not.toBe(canonicalEventFingerprint(event))
      expect((await new TransactionalOutbox(repository).enqueue(retried)).id).toBe(original.id)
      expect(repository.records).toHaveLength(1)
      await expect(
        new TransactionalOutbox(repository).enqueue({
          ...event,
          data: { ...event.data, total_minor: 999 },
        }),
      ).rejects.toThrow(/collision/)
      // The persisted canonical message stays unchanged after replay.
      expect(repository.records[0].envelope.traceparent).toBe(event.traceparent)
    } finally {
      console.info = logger
    }
  })
})
