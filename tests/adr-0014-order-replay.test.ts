import { describe, expect, it, vi } from "vitest"
import {
  assertUnchangedOrderAttempt, MedusaOrderOrchestrationAdapter,
  type OrderCommand, type OrderRecordRepository, type OrderSnapshot,
} from "../src/baobab/orders/orchestration-port"

const command: OrderCommand = {
  orderReference: "purchase-1", organisationId: "buyer-za",
  marketKey: "zuribeans_za", legalSellerKey: "seller-za",
  currencyCode: "ZAR", totalMinor: 10000,
  idempotencyKey: "cart-commit-1", correlationId: "corr-1",
}
const snapshot: OrderSnapshot = { ...command, id: "order_1", status: "PENDING" }
const repository = (stored: OrderSnapshot | undefined) => {
  const repo = {
    findByIdempotencyKey: vi.fn(async () => stored),
    create: vi.fn(async (_c: OrderCommand) => snapshot),
    retrieve: vi.fn(async () => snapshot),
  }
  return repo
}
describe("ADR-0014 immutable purchase idempotency scope", () => {
  it("returns an unchanged committed result after response loss without another write", async () => {
    const repo = repository(snapshot)
    const result = await new MedusaOrderOrchestrationAdapter(repo).place({
      ...command, correlationId: "retry-correlation",
    })
    expect(result).toBe(snapshot)
    expect(repo.create).not.toHaveBeenCalled()
  })

  it.each([
    ["buyer", { organisationId: "buyer-ug" }],
    ["seller", { legalSellerKey: "seller-ug" }],
    ["Market", { marketKey: "zuribeans_ug" }],
    ["currency", { currencyCode: "UGX" }],
    ["amount", { totalMinor: 9000 }],
    ["order reference", { orderReference: "purchase-2" }],
  ] as const)("refuses idempotency-key reuse with changed %s", async (_name, change) => {
    const repo = repository(snapshot)
    await expect(new MedusaOrderOrchestrationAdapter(repo).place({
      ...command, ...change,
    })).rejects.toThrow("different purchase")
    expect(repo.create).not.toHaveBeenCalled()
  })

  it("never reveals an unrelated stored Order via a matching key", () => {
    expect(() => assertUnchangedOrderAttempt(command, {
      ...snapshot, organisationId: "attacker",
    })).toThrow("different purchase")
  })

  it("refuses a wrong native record returned on create, not just on read", async () => {
    const repo = repository(undefined)
    repo.create.mockResolvedValueOnce({
      ...snapshot, legalSellerKey: "other-seller",
    })
    await expect(new MedusaOrderOrchestrationAdapter(repo).place(command)).rejects.toThrow(
      "different purchase",
    )
  })

  it("rejects empty or malformed idempotency and authority references before persistence", async () => {
    for (const change of [
      { idempotencyKey: "" }, { organisationId: "" }, { legalSellerKey: "" },
      { marketKey: " " }, { orderReference: "" }, { correlationId: "" },
    ]) {
      const repo = repository(undefined)
      await expect(new MedusaOrderOrchestrationAdapter(repo).place({
        ...command, ...change,
      })).rejects.toThrow("authority identifiers")
      expect(repo.findByIdempotencyKey).not.toHaveBeenCalled()
      expect(repo.create).not.toHaveBeenCalled()
    }
  })

  it("does not accept an order with an unknown/empty result ID as successful", () => {
    expect(() => assertUnchangedOrderAttempt(command, {...snapshot, id:""})).toThrow(
      "different purchase",
    )
  })
})
