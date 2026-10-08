import { describe, expect, it } from "vitest"
import {
  DurableErpIntegrationAdapter,
  assertFinancialProjection,
  reconcileErpProjection,
  type ErpProjectionCommand,
  type ErpProjectionRepository,
} from "../src/baobab/erp-integration"
class MemoryRepository implements ErpProjectionRepository {
  records = new Map<string, { id: string; commandDigest: string }>()
  async findByIdempotencyKey(key: string) {
    return this.records.get(key)
  }
  async create(command: ErpProjectionCommand & { commandDigest: string }) {
    const result = {
      id: `projection-${this.records.size + 1}`,
      commandDigest: command.commandDigest,
    }
    this.records.set(command.idempotencyKey, result)
    return result
  }
}
const command: ErpProjectionCommand = {
  kind: "ORDER",
  commerceReference: "order-1",
  canonicalEntityId: "canonical:order:1",
  legalSellerKey: "seller-ug",
  marketKey: "zuribeans_ug",
  payload: { currency: "UGX" },
  idempotencyKey: "idem-1",
  correlationId: "corr-1",
}
describe("ERP integration projections", () => {
  it("queues Order/Fulfilment projections idempotently", async () => {
    const adapter = new DurableErpIntegrationAdapter(new MemoryRepository())
    const first = await adapter.queue(command)
    expect((await adapter.queue(command)).id).toBe(first.id)
    await expect(adapter.queue({ ...command, payload: { retry: true } })).rejects.toThrow(
      /different projection content/,
    )
  })
  it("rejects stale or invalid financial status", () => {
    const projection = {
      commercePaymentReference: "pay",
      erpPaymentReference: "erp",
      status: "OPEN" as const,
      amountMinor: 100,
      outstandingMinor: 100,
      currency: "UGX",
      sourceSequence: 2,
      sourceIdempotencyKey: "fin-2",
      observedAt: new Date(),
    }
    expect(() => assertFinancialProjection(2, projection)).toThrow(/Stale/)
    expect(() => assertFinancialProjection(null, { ...projection, outstandingMinor: 101 })).toThrow(
      /amounts/,
    )
  })
  it("records pending ERP and field-level variance", () => {
    expect(reconcileErpProjection({ expected: { status: "PENDING" } }).status).toBe("PENDING_ERP")
    expect(
      reconcileErpProjection({
        expected: { status: "PENDING", currency: "UGX" },
        observed: { status: "ACKNOWLEDGED", currency: "UGX" },
      }),
    ).toEqual({ status: "VARIANCE", differences: ["status"] })
  })
})
