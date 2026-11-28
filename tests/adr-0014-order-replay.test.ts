import { describe, expect, it, vi } from "vitest"
import {
  assertUnchangedOrderAttempt,
  MedusaOrderOrchestrationAdapter,
  type OrderCommand,
  type OrderRecordRepository,
  type OrderSnapshot,
} from "../src/baobab/orders/orchestration-port"

const command: OrderCommand = {
  orderReference: "purchase-1",
  tenantId: "tn_zaoperator",
  principalId: "principal_za_1",
  organisationId: "buyer-za",
  marketId: "mkt_01k9za7b2b",
  marketRevision: 1,
  marketKey: "zuribeans.za",
  legalSellerKey: "seller-za",
  currencyCode: "ZAR",
  totalMinor: 10000,
  idempotencyKey: "cart-commit-1",
  correlationId: "corr-1",
}
const snapshot: OrderSnapshot = { ...command, id: "order_1", status: "PENDING" }
const repository = (stored: OrderSnapshot | undefined) => {
  const repo = {
    findByIdempotencyKey: vi.fn(
      async (
        _key: string,
        _scope: { tenantId: string; principalId: string; organisationId: string },
      ) => stored,
    ),
    create: vi.fn(async (_c: OrderCommand) => snapshot),
    retrieve: vi.fn(async () => snapshot),
  }
  return repo
}

describe("ADR-0014 immutable purchase idempotency scope", () => {
  it("returns an unchanged committed result after response loss without another write", async () => {
    const repo = repository(snapshot)
    const result = await new MedusaOrderOrchestrationAdapter(repo).place({
      ...command,
      correlationId: "retry-correlation",
    })
    expect(result).toBe(snapshot)
    expect(repo.findByIdempotencyKey).toHaveBeenCalledWith("cart-commit-1", {
      tenantId: "tn_zaoperator",
      principalId: "principal_za_1",
      organisationId: "buyer-za",
    })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it.each([
    ["tenant", { tenantId: "tn_ugoperator" }],
    ["Principal", { principalId: "principal_za_2" }],
    ["buyer organisation", { organisationId: "buyer-ug" }],
    ["seller", { legalSellerKey: "seller-ug" }],
    ["Market key", { marketKey: "zuribeans.ug" }],
    ["Market ID", { marketId: "mkt_01k9za7b2c" }],
    ["Market revision", { marketRevision: 2 }],
    ["currency", { currencyCode: "UGX" }],
    ["amount", { totalMinor: 9000 }],
    ["order reference", { orderReference: "purchase-2" }],
  ] as const)("refuses idempotency-key reuse with changed %s", async (_name, change) => {
    const repo = repository(snapshot)
    await expect(
      new MedusaOrderOrchestrationAdapter(repo).place({
        ...command,
        ...change,
      }),
    ).rejects.toThrow("different purchase")
    expect(repo.create).not.toHaveBeenCalled()
  })

  it("never reveals an unrelated stored Order via a matching key", () => {
    expect(() =>
      assertUnchangedOrderAttempt(command, {
        ...snapshot,
        organisationId: "attacker",
      }),
    ).toThrow("different purchase")
  })

  it("refuses a wrong native record returned on create, not just on read", async () => {
    const repo = repository(undefined)
    repo.create.mockResolvedValueOnce({
      ...snapshot,
      legalSellerKey: "other-seller",
    })
    await expect(new MedusaOrderOrchestrationAdapter(repo).place(command)).rejects.toThrow(
      "different purchase",
    )
  })

  it("rejects empty or malformed idempotency and authority references before persistence", async () => {
    for (const change of [
      { idempotencyKey: "" },
      { tenantId: "" },
      { principalId: "" },
      { organisationId: "" },
      { legalSellerKey: "" },
      { marketKey: " " },
      { orderReference: "" },
      { correlationId: "" },
      { marketId: "mkt__bad" },
      { marketRevision: 0 },
    ]) {
      const repo = repository(undefined)
      await expect(
        new MedusaOrderOrchestrationAdapter(repo).place({
          ...command,
          ...change,
        }),
      ).rejects.toThrow()
      expect(repo.findByIdempotencyKey).not.toHaveBeenCalled()
      expect(repo.create).not.toHaveBeenCalled()
    }
  })

  it("does not accept an order with an unknown/empty result ID as successful", () => {
    expect(() => assertUnchangedOrderAttempt(command, { ...snapshot, id: "" })).toThrow(
      "different purchase",
    )
  })

  it("rejects a native retrieve result whose ID differs from the requested order", async () => {
    const repo = repository(snapshot)
    repo.retrieve.mockResolvedValueOnce({ ...snapshot, id: "order_2" })
    await expect(new MedusaOrderOrchestrationAdapter(repo).retrieve("order_1")).rejects.toThrow(
      "different order",
    )
  })

  it("rejects malformed order identifiers before repository access", async () => {
    const repo = repository(snapshot)
    await expect(new MedusaOrderOrchestrationAdapter(repo).retrieve("order/1")).rejects.toThrow(
      "identifier is invalid",
    )
    expect(repo.retrieve).not.toHaveBeenCalled()
  })
})
