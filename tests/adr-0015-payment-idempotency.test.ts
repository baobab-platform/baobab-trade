import { describe, expect, it, vi } from "vitest"
import {
  assertSamePaymentAttempt,
  MedusaPaymentOrchestrationAdapter,
  type InitiatePaymentCommand,
  type PaymentSnapshot,
} from "../src/baobab/payments/orchestration-port"

const cmd: InitiatePaymentCommand = {
  paymentReference: "pay-1",
  orderReference: "order-1",
  organisationId: "org-a",
  marketKey: "zuribeans-za",
  legalSellerKey: "seller-za",
  method: "BANK_TRANSFER",
  terms: "PREPAID",
  providerKey: "merchant-za",
  currency: "ZAR",
  amountMinor: 150000,
  idempotencyKey: "pay-attempt-a",
  correlationId: "corr-1",
}
const snapshot: PaymentSnapshot = {
  ...cmd,
  digitalEstate: "estate:zuribeans-b2b",
  id: "pay_1",
  status: "PENDING",
}
const repository = (stored: PaymentSnapshot | undefined) => ({
  findByIdempotencyKey: vi.fn(async () => stored),
  create: vi.fn(async () => snapshot),
  transition: vi.fn(async () => snapshot),
})

describe("ADR-0015 payment idempotency and merchant isolation", () => {
  it("adopts an identical attempt after lost response, allowing new correlation only", async () => {
    const db = repository(snapshot)
    const v = await new MedusaPaymentOrchestrationAdapter(db).initiate({
      ...cmd,
      correlationId: "corr-retry",
    })
    expect(v).toBe(snapshot)
    expect(db.create).not.toHaveBeenCalled()
  })
  it.each([
    ["buyer", { organisationId: "org-b" }],
    ["seller", { legalSellerKey: "seller-ug" }],
    ["Market", { marketKey: "zuribeans-ug" }],
    ["merchant", { providerKey: "merchant-other" }],
    ["currency", { currency: "UGX" }],
    ["amount", { amountMinor: 145000 }],
    ["terms", { terms: "NET_30" as const, method: "INVOICE_TERMS" as const }],
    ["order", { orderReference: "order-2" }],
    ["payment reference", { paymentReference: "pay-2" }],
  ])("rejects a reused financial key with changed %s", async (_label, change) => {
    const db = repository(snapshot)
    await expect(
      new MedusaPaymentOrchestrationAdapter(db).initiate({
        ...cmd,
        ...change,
      }),
    ).rejects.toThrow("different financial attempt")
    expect(db.create).not.toHaveBeenCalled()
  })
  it("rejects provider-lock readback of a different merchant or seller", async () => {
    const db = repository(undefined)
    db.create.mockResolvedValueOnce({ ...snapshot, providerKey: "merchant-ug" })
    await expect(new MedusaPaymentOrchestrationAdapter(db).initiate(cmd)).rejects.toThrow(
      "different financial attempt",
    )
  })
  it("refuses different Digital Estate even with unchanged payment fields", () => {
    expect(() =>
      assertSamePaymentAttempt(
        {
          ...cmd,
          digitalEstate: "estate:thamani-b2c",
        },
        snapshot,
      ),
    ).toThrow("different financial attempt")
  })
  it("does not treat a changed invoice due date as identical financial terms", () => {
    const dated = { ...snapshot, dueAt: new Date("2026-12-09T00:00:00Z") }
    expect(() =>
      assertSamePaymentAttempt(
        {
          ...cmd,
          digitalEstate: snapshot.digitalEstate,
          dueAt: new Date("2027-01-09T00:00:00Z"),
        },
        dated,
      ),
    ).toThrow("different financial attempt")
  })
})
