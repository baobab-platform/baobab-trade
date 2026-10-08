import { isValidCloudEvent, type BaobabCloudEvent } from "./event-contracts"

export interface EventPublisher {
  publish<TData extends Record<string, unknown>>(event: BaobabCloudEvent<TData>): Promise<void>
}

export interface MedusaEventBus {
  emit(input: { name: string; data: Record<string, unknown> }): Promise<void>
}

/** Publishes the complete governed envelope; consumers must never receive data alone. */
export class MedusaEventBusPublisher implements EventPublisher {
  constructor(private readonly eventBus: MedusaEventBus) {}

  async publish<TData extends Record<string, unknown>>(event: BaobabCloudEvent<TData>) {
    if (!isValidCloudEvent(event)) throw new Error(`Refusing to publish a non-conforming event`)
    await this.eventBus.emit({ name: event.type, data: event })
  }
}

export class NoopEventPublisher implements EventPublisher {
  public readonly published: BaobabCloudEvent<Record<string, unknown>>[] = []

  async publish<TData extends Record<string, unknown>>(
    event: BaobabCloudEvent<TData>,
  ): Promise<void> {
    const eventType = event.type
    if (!isValidCloudEvent(event)) {
      throw new Error(`Refusing to publish a non-conforming event: ${eventType}`)
    }
    this.published.push(event)
  }
}
