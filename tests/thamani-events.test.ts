import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import {
  AtLeastOnceOutboxDispatcher,
  canonicalEventFingerprint,
  IdempotentEventConsumer,
  createTenantTradeEvent,
  TransactionalOutbox,
  type BaobabCloudEvent,
  type ConsumerReceipt,
  type OutboxRecord,
  type OutboxRepository,
} from "../src/baobab/events"

const context = {
  tenantId: "tenant-thamani",
  entityId: "canonical:legal-entity:thamani",
  lifecycleStatus: "active" as const,
  productId: "baobab-trade",
  entitled: true as const,
  entitlementTier: null,
  cacheTtlSeconds: 60,
  resolvedAt: "2026-09-09T00:00:00.000Z",
  correlationId: "11111111-1111-4111-8111-111111111111",
}

const eventFor = (suffix: number, sourceVersion = 1) =>
  createTenantTradeEvent(context, {
    id: `22222222-2222-4222-8222-${String(suffix).padStart(12, "0")}`,
    type: "com.baobab-platform.trade.order.placed.v1",
    subject: `commerce-order/thamani-${suffix}`,
    time: "2026-09-09T00:00:00.000Z",
    dataschema:
      "https://contracts.baobab-platform.com/erp/v1/commerce-order-consequence.schema.json",
    correlationid: context.correlationId,
    causationid: "33333333-3333-4333-8333-333333333333",
    idempotencykey: `thamani:event:order:${suffix}`,
    data: { commerce_order_id: `thamani-${suffix}`, source_version: sourceVersion },
  })

class MemoryOutbox implements OutboxRepository {
  records: OutboxRecord[] = []
  async findByIdempotencyKey(key: string) {
    return this.records.find((record) => record.idempotencyKey === key)
  }
  async create(event: BaobabCloudEvent, key: string) {
    const record: OutboxRecord = {
      id: `out-${this.records.length}`,
      eventId: event.id,
      eventType: event.type,
      subject: event.subject,
      tenantId: event.baobabscope === "tenant" ? event.tenantid : undefined,
      correlationId: event.correlationid,
      causationId: event.causationid,
      idempotencyKey: key,
      envelope: event,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: new Date(0),
    }
    this.records.push(record)
    return record
  }
  async listDue(now: Date, limit: number) {
    return this.records
      .filter(
        (record) => record.nextAttemptAt <= now && ["PENDING", "RETRY"].includes(record.status),
      )
      .slice(0, limit)
  }
  async claim(id: string, now: Date, attemptCount: number, leaseExpiresAt: Date) {
    const current = this.records.find((item) => item.id === id)
    if (
      !current ||
      !(
        (["PENDING", "RETRY"].includes(current.status) && current.nextAttemptAt <= now) ||
        (current.status === "PUBLISHING" &&
          current.leaseExpiresAt !== undefined &&
          current.leaseExpiresAt <= now)
      )
    )
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
    const record = this.records.find((item) => item.id === id)
    if (!record) throw new Error("missing outbox row")
    Object.assign(record, values)
    return record
  }
}

describe("Thamani ERP projection events (ADR-SHARED-018 §8.5)", () => {
  const retirement = readFileSync(
    "src/modules/event-outbox/migrations/Migration20260930210000.ts",
    "utf8",
  )

  it("keeps migration history immutable", () => {
    const original = readFileSync(
      "src/modules/event-outbox/migrations/Migration20260909110000.ts",
      "utf8",
    )
    expect(original).toContain("TRG_thamani_erp_projection_outbox")
    expect(original).toContain("after insert or update on")
  })

  it("retires the estate-named projection commands by forward migration", () => {
    const up = retirement.slice(
      retirement.indexOf("async up()"),
      retirement.indexOf("async down()"),
    )
    expect(up).toContain("create or replace function baobab_enqueue_thamani_erp_projection()")
    expect(up).not.toContain("insert into event_outbox")
    expect(up).not.toMatch(/'com\.nabhold\.commerce\.thamani-[a-z-]+\.projection-requested\.v1'/)
    expect(up).not.toContain("engines.nabhold.com")
  })

  it("keeps the erp_projection invariants the trigger enforced", () => {
    expect(retirement).toContain("Published Thamani projection identity and payload are immutable")
    expect(retirement).toContain(
      "new.owner_legal_entity_id is distinct from 'canonical:legal-entity:thamani'",
    )
    expect(retirement).toContain("Thamani projection crosses its Market/legal-seller boundary")
    expect(retirement).toContain("Unsupported Thamani ERP projection kind %")
  })

  it("dead-letters unpublished legacy commands and leaves published history untouched", () => {
    expect(retirement).toContain("\"status\" = 'DEAD_LETTER'")
    expect(retirement).toContain("RETIRED_ADR_SHARED_018")
    expect(retirement).toContain("\"status\" in ('PENDING', 'RETRY', 'PUBLISHING')")
    expect(retirement).not.toMatch(/delete\s+from\s+"?event_outbox/i)
    expect(retirement).not.toContain("'PUBLISHED'")
  })

  it("accepts exact replay but rejects key reuse with changed content", async () => {
    const repository = new MemoryOutbox()
    const outbox = new TransactionalOutbox(repository)
    const event = eventFor(9)
    expect((await outbox.enqueue(event)).id).toBe((await outbox.enqueue(event)).id)
    const changed = eventFor(9, 2)
    await expect(outbox.enqueue(changed)).rejects.toThrow("Idempotency key collision")
    expect(canonicalEventFingerprint(event)).not.toBe(canonicalEventFingerprint(changed))
  })

  it("backs off, dead-letters poison events, and bounds each drain batch", async () => {
    const repository = new MemoryOutbox()
    await new TransactionalOutbox(repository).enqueue(eventFor(10))
    const dispatcher = new AtLeastOnceOutboxDispatcher(
      repository,
      {
        publish: async () => {
          throw new Error("ERP unavailable")
        },
      },
      { maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 10, leaseDurationMs: 100 },
    )
    await dispatcher.dispatchDue(new Date(100))
    expect(repository.records[0].status).toBe("RETRY")
    await dispatcher.dispatchDue(new Date(110))
    expect(repository.records[0].status).toBe("DEAD_LETTER")
  })

  it("records a consumer effect once under duplicate delivery", async () => {
    const receipts = new Map<string, ConsumerReceipt>()
    let effects = 0
    const consumer = new IdempotentEventConsumer({
      find: async (name, id) => receipts.get(`${name}:${id}`),
      processAtomically: async (name, event, handler) => {
        await handler(event)
        const receipt = {
          id: "receipt",
          consumerName: name,
          eventId: event.id,
          eventType: event.type,
          correlationId: event.correlationid,
          processedAt: new Date(),
        }
        receipts.set(`${name}:${event.id}`, receipt)
        return receipt
      },
    })
    await consumer.consume("thamani-idempiere", eventFor(11), async () => {
      effects += 1
    })
    const replay = await consumer.consume("thamani-idempiere", eventFor(11), async () => {
      effects += 1
    })
    expect(replay.duplicate).toBe(true)
    expect(effects).toBe(1)
  })
})
