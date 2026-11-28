import type { ILockingModule } from "@medusajs/framework/types"
import type PaymentBridgeModuleService from "../src/modules/payment-bridge/service"
import { describe, expect, it, vi } from "vitest"
import { PaymentBridgeRecordAdapter } from "../src/baobab/payments/payment-record-adapter"
import type { InitiatePaymentCommand } from "../src/baobab/payments/orchestration-port"

const command: InitiatePaymentCommand & { digitalEstate: string } = {
  paymentReference: "payment-1",
  orderReference: "order-1",
  tenantId: "tn_zaoperator",
  principalId: "principal_za_1",
  organisationId: "org-za",
  marketId: "mkt_01k9za7b2b",
  marketRevision: 1,
  marketKey: "zuribeans_za",
  legalSellerKey: "seller-za",
  method: "BANK_TRANSFER",
  terms: "PREPAID",
  providerKey: "stripe",
  merchantAccountId: "merchant-account-za",
  providerEnvironment: "SANDBOX",
  currency: "ZAR",
  amountMinor: 150000,
  idempotencyKey: "init-1",
  correlationId: "corr-1",
  digitalEstate: "entity:zuribeans",
}

const row = {
  id: "pay_1",
  digital_estate: "entity:zuribeans",
  tenant_id: "tn_zaoperator",
  principal_id: "principal_za_1",
  merchant_account_id: "merchant-account-za",
  provider_environment: "SANDBOX",
  payment_reference: "payment-1",
  order_reference: "order-1",
  organisation_id: "org-za",
  customer_reference: null,
  market_id: "mkt_01k9za7b2b",
  market_revision: "1",
  market_key: "zuribeans_za",
  legal_seller_key: "seller-za",
  method: "BANK_TRANSFER",
  terms: "PREPAID",
  provider_key: "stripe",
  provider_reference: null,
  provider_status: null,
  currency_code: "ZAR",
  amount_minor: "150000",
  status: "CREATED",
  source_idempotency_key: "init-1",
  correlation_id: "corr-1",
  due_at: null,
}

const harness = (initial = row) => {
  let current: Record<string, unknown> = { ...initial }
  const bridge = {
    listCommercePayments: vi.fn(async () => [current]),
    createCommercePayments: vi.fn(async (input: Record<string, unknown>) => {
      current = { ...current, ...input }
      return current
    }),
    listPaymentStatusTransitions: vi.fn(async () => []),
    createPaymentStatusTransitions: vi.fn(async () => ({})),
    updateCommercePayments: vi.fn(async (input: Record<string, unknown>) => {
      current = { ...current, ...input }
      return current
    }),
  }
  const locking = {
    execute: vi.fn(async (_key: string, callback: () => Promise<unknown>) => callback()),
  }
  return {
    bridge,
    locking,
    adapter: new PaymentBridgeRecordAdapter(
      bridge as unknown as PaymentBridgeModuleService,
      locking as unknown as ILockingModule,
    ),
    setCurrent: (value: Record<string, unknown>) => {
      current = { ...value }
    },
  }
}

describe("ADR-0015 PaymentBridge persistence adapter", () => {
  it("reads exact amount and Market revision with tenant and merchant identity", async () => {
    const h = harness()
    const result = await h.adapter.findByIdempotencyKey("init-1")
    expect(result).toMatchObject({
      id: "pay_1",
      tenantId: "tn_zaoperator",
      principalId: "principal_za_1",
      merchantAccountId: "merchant-account-za",
      providerEnvironment: "SANDBOX",
      marketId: "mkt_01k9za7b2b",
      marketRevision: 1,
      amountMinor: 150000,
    })
  })

  it("refuses legacy or corrupt payment amounts outside the safe integer contract", async () => {
    const h = harness({ ...row, amount_minor: "9007199254740993" })
    await expect(h.adapter.findByIdempotencyKey("init-1")).rejects.toThrow(
      "safe integer boundary",
    )
  })

  it("refuses legacy rows without authoritative tenant and merchant fields", async () => {
    const h = harness({
      ...row,
      tenant_id: null,
      merchant_account_id: null,
      provider_environment: null,
    })
    await expect(h.adapter.findByIdempotencyKey("init-1")).rejects.toThrow(
      "authoritative tenant",
    )
  })

  it("persists tenant, Principal, Market revision and merchant environment on create", async () => {
    const h = harness()
    h.bridge.listCommercePayments.mockResolvedValueOnce([])
    const created = await h.adapter.create(command)
    expect(created).toMatchObject({
      tenantId: command.tenantId,
      principalId: command.principalId,
      marketId: command.marketId,
      marketRevision: command.marketRevision,
      merchantAccountId: command.merchantAccountId,
      providerEnvironment: command.providerEnvironment,
    })
    expect(h.bridge.createCommercePayments).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: command.tenantId,
        principal_id: command.principalId,
        market_id: command.marketId,
        market_revision: command.marketRevision,
        merchant_account_id: command.merchantAccountId,
        provider_environment: command.providerEnvironment,
      }),
    )
  })

  it("applies a transition and verifies provider evidence in the writeback", async () => {
    const h = harness({ ...row, status: "PENDING" })
    const result = await h.adapter.transition(
      "pay_1",
      "PENDING",
      "CAPTURED",
      "transition-1",
      "psp-transaction-1",
      "CAPTURED",
    )
    expect(result).toMatchObject({
      id: "pay_1",
      status: "CAPTURED",
      providerReference: "psp-transaction-1",
      providerStatus: "CAPTURED",
    })
  })

  it("does not hide a transition log whose payment-state writeback did not commit", async () => {
    const h = harness({ ...row, status: "PENDING" })
    h.bridge.listPaymentStatusTransitions.mockResolvedValueOnce([
      {
        payment_id: "pay_1",
        from_status: "PENDING",
        to_status: "CAPTURED",
        provider_reference: "psp-transaction-1",
        provider_status: "CAPTURED",
      },
    ])
    await expect(
      h.adapter.transition(
        "pay_1",
        "PENDING",
        "CAPTURED",
        "transition-1",
        "psp-transaction-1",
        "CAPTURED",
      ),
    ).rejects.toThrow("reconciliation is required")
    expect(h.bridge.updateCommercePayments).not.toHaveBeenCalled()
  })
})
