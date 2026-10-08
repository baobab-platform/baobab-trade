import { createHash } from "node:crypto"
import { isValidCloudEvent, type BaobabCloudEvent } from "./event-contracts"
import type { EventPublisher } from "./publisher"

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`
  return JSON.stringify(value)
}

export const canonicalEventFingerprint = (event: BaobabCloudEvent): string =>
  createHash("sha256").update(stableJson(event)).digest("hex")

export type OutboxStatus = "PENDING" | "PUBLISHING" | "PUBLISHED" | "RETRY" | "DEAD_LETTER"

export type OutboxRecord = {
  id: string
  eventId: string
  eventType: string
  subject: string
  tenantId?: string
  correlationId: string
  causationId?: string
  idempotencyKey: string
  envelope: BaobabCloudEvent
  status: OutboxStatus
  attemptCount: number
  nextAttemptAt: Date
  publishedAt?: Date
  leaseExpiresAt?: Date
  lastErrorCode?: string
}

export interface OutboxRepository {
  findByIdempotencyKey(key: string): Promise<OutboxRecord | undefined>
  create(event: BaobabCloudEvent, idempotencyKey: string): Promise<OutboxRecord>
  listDue(now: Date, limit: number): Promise<OutboxRecord[]>
  claim(
    id: string,
    now: Date,
    attemptCount: number,
    leaseExpiresAt: Date,
  ): Promise<OutboxRecord | undefined>
  markPublished(id: string, publishedAt: Date): Promise<OutboxRecord>
  markRetry(id: string, nextAttemptAt: Date, errorCode: string): Promise<OutboxRecord>
  markDeadLetter(id: string, errorCode: string): Promise<OutboxRecord>
}

export type RetryPolicy = {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  leaseDurationMs: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 8,
  initialDelayMs: 1_000,
  maxDelayMs: 300_000,
  leaseDurationMs: 60_000,
}

const errorCode = (error: unknown): string => {
  if (error instanceof Error && error.name) return error.name.slice(0, 100)
  return "PUBLISH_FAILED"
}

export class TransactionalOutbox {
  constructor(private readonly repository: OutboxRepository) {}

  /** Call inside the same local database transaction as the commerce mutation. */
  async enqueue<T extends Record<string, unknown>>(event: BaobabCloudEvent<T>) {
    if (!isValidCloudEvent(event))
      throw new Error("Cannot enqueue a non-conforming canonical event")
    if (!event.idempotencykey) throw new Error("Durable events require an idempotency key")
    const existing = await this.repository.findByIdempotencyKey(event.idempotencykey)
    if (existing) {
      if (canonicalEventFingerprint(existing.envelope) !== canonicalEventFingerprint(event))
        throw new Error("Idempotency key collision: canonical event payload differs")
      return existing
    }
    return this.repository.create(event, event.idempotencykey)
  }
}

export class AtLeastOnceOutboxDispatcher {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: EventPublisher,
    private readonly retry: RetryPolicy = DEFAULT_RETRY_POLICY,
  ) {}

  async dispatchDue(now = new Date(), limit = 100) {
    const due = await this.repository.listDue(now, Math.max(0, Math.min(limit, 500)))
    const results: OutboxRecord[] = []
    for (const candidate of due) {
      const attempt = candidate.attemptCount + 1
      const claimed = await this.repository.claim(
        candidate.id,
        now,
        attempt,
        new Date(now.getTime() + this.retry.leaseDurationMs),
      )
      if (!claimed) continue
      try {
        await this.publisher.publish(claimed.envelope)
        results.push(await this.repository.markPublished(claimed.id, now))
      } catch (error) {
        const code = errorCode(error)
        if (attempt >= this.retry.maxAttempts) {
          results.push(await this.repository.markDeadLetter(claimed.id, code))
          continue
        }
        const delay = Math.min(
          this.retry.initialDelayMs * 2 ** Math.max(0, attempt - 1),
          this.retry.maxDelayMs,
        )
        results.push(
          await this.repository.markRetry(claimed.id, new Date(now.getTime() + delay), code),
        )
      }
    }
    return results
  }
}

export type ConsumerReceipt = {
  id: string
  consumerName: string
  eventId: string
  eventType: string
  correlationId: string
  processedAt: Date
}

export interface ConsumerReceiptRepository {
  find(consumerName: string, eventId: string): Promise<ConsumerReceipt | undefined>
  /** Persist the business effect and receipt atomically; uniqueness arbitrates concurrent duplicates. */
  processAtomically<T extends Record<string, unknown>>(
    consumerName: string,
    event: BaobabCloudEvent<T>,
    handler: (event: BaobabCloudEvent<T>) => Promise<void>,
  ): Promise<ConsumerReceipt>
}

export class IdempotentEventConsumer {
  constructor(private readonly receipts: ConsumerReceiptRepository) {}

  async consume<T extends Record<string, unknown>>(
    consumerName: string,
    event: BaobabCloudEvent<T>,
    handler: (event: BaobabCloudEvent<T>) => Promise<void>,
  ): Promise<{ duplicate: boolean; receipt: ConsumerReceipt }> {
    if (!isValidCloudEvent(event)) throw new Error("Refusing a non-conforming canonical event")
    const existing = await this.receipts.find(consumerName, event.id)
    if (existing) return { duplicate: true, receipt: existing }
    const receipt = await this.receipts.processAtomically(consumerName, event, handler)
    return { duplicate: false, receipt }
  }
}

export const reconcileOutboxRecord = (record: OutboxRecord, now = new Date()) => {
  if (record.status === "DEAD_LETTER")
    return { status: "ACTION_REQUIRED" as const, reason: "DEAD_LETTER" }
  if (record.status === "PUBLISHED") return { status: "MATCHED" as const }
  if (record.status === "PUBLISHING" && record.leaseExpiresAt && record.leaseExpiresAt <= now)
    return { status: "RETRY_DUE" as const, reason: "PUBLISH_LEASE_EXPIRED" }
  if (record.nextAttemptAt.getTime() <= now.getTime())
    return { status: "RETRY_DUE" as const, reason: record.lastErrorCode }
  return { status: "PENDING" as const, reason: record.lastErrorCode }
}
