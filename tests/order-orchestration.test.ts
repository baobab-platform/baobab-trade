import { describe, expect, it } from "vitest"
import {
  MedusaOrderOrchestrationAdapter,
  type OrderCommand,
  type OrderRecordRepository,
  type OrderSnapshot,
} from "../src/baobab/orders"

const command: OrderCommand = {
  orderReference: "order-18",
  organisationId: "org-1",
  marketKey: "zuribeans_ug",
  legalSellerKey: "zuribeans-uganda",
  currencyCode: "UGX",
  totalMinor: 1000,
  idempotencyKey: "gate18:order",
  correlationId: "corr-18",
}

class MemoryRepository implements OrderRecordRepository {
  records = new Map<string, OrderSnapshot>()
  byId = new Map<string, OrderSnapshot>()
  async findByIdempotencyKey(key: string) {
    return this.records.get(key)
  }
  async create(input: OrderCommand) {
    const order = { ...input, id: `order_${this.records.size + 1}`, status: "PENDING" }
    this.records.set(input.idempotencyKey, order)
    this.byId.set(order.id, order)
    return order
  }
  async retrieve(id: string) {
    const order = this.byId.get(id)
    if (!order) throw new Error(`Order ${id} does not exist`)
    return order
  }
}

describe("OrderOrchestrationPort contract (MedusaOrderOrchestrationAdapter)", () => {
  it("places idempotently, returning the same order for a replayed idempotency key", async () => {
    const adapter = new MedusaOrderOrchestrationAdapter(new MemoryRepository())
    const first = await adapter.place(command)
    const replayed = await adapter.place(command)
    expect(replayed.id).toBe(first.id)
  })

  it("rejects a negative or non-integer order total", async () => {
    const adapter = new MedusaOrderOrchestrationAdapter(new MemoryRepository())
    await expect(adapter.place({ ...command, totalMinor: -1 })).rejects.toThrow(
      "non-negative safe integer",
    )
    await expect(adapter.place({ ...command, totalMinor: 10.5 })).rejects.toThrow(
      "non-negative safe integer",
    )
  })

  it("rejects a currency code that isn't an uppercase ISO 4217 code", async () => {
    const adapter = new MedusaOrderOrchestrationAdapter(new MemoryRepository())
    await expect(adapter.place({ ...command, currencyCode: "ugx" })).rejects.toThrow("ISO 4217")
  })

  it("retrieves by id after placement and propagates a not-found error for an unknown id", async () => {
    const adapter = new MedusaOrderOrchestrationAdapter(new MemoryRepository())
    const placed = await adapter.place(command)
    expect(await adapter.retrieve(placed.id)).toMatchObject({ id: placed.id, status: "PENDING" })
    await expect(adapter.retrieve("order_missing")).rejects.toThrow("does not exist")
  })
})
