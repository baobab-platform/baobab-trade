import { describe, expect, it } from "vitest"
import {
  BuyerAuthorityReceiptRefused,
  PostgresBuyerAuthorityReceiptStore,
  type BuyerAuthorityReceipt,
} from "../src/baobab/b2b/buyer-authority-receipt-store"
import { buyerAuthorityReceiptSchema } from "../src/baobab/contracts/authority-validation"

/**
 * ADR-SHARED-042 Decision 6: Trade records only a contract-valid buyer
 * receipt. Synthetic values only; the database rules are proven by
 * regression:trade-a-commit-fences.
 */
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0)
const receipt = (change: Partial<BuyerAuthorityReceipt> = {}): BuyerAuthorityReceipt => ({
  receipt_id: "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
  context_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  decision_id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  correlation_id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  operation: "trade.order.commit",
  operation_reference: "trade/trade.order.commit/cart_synthetic01/1/1",
  actor_principal_id: "4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f8a",
  tenant_id: "tn_synthetic01",
  canonical_organisation_id: "5e6f7a8b-9c0d-4e1f-8a2b-4c5d6e7f8a9b",
  buyer_organisation_id: "b2borg_synthetic01",
  buyer_membership_id: "b2bmem_synthetic01",
  membership_revision: 1,
  market_id: "market_synthetic",
  resource_id: "cart_synthetic01",
  resource_version: 1,
  transaction_digest: `sha256:${"b".repeat(64)}`,
  amount_minor: 125_000,
  valuation_digest: `sha256:${"a".repeat(64)}`,
  currency: "UGX",
  policy_revision: "1",
  spend_reservation_id: "b2bres_synthetic01",
  spend_hold_revision: 1,
  seller_legal_entity_id: "SYNTHETIC-LE-01",
  seller_binding_reference: {
    binding_id: "6f7a8b9c-0d1e-4f2a-9b3c-5d6e7f8a9b0c",
    binding_version: 1,
  },
  evaluated_at: new Date(NOW).toISOString(),
  expires_at: new Date(NOW + 50_000).toISOString(),
  ...change,
})

describe("PostgresBuyerAuthorityReceiptStore", () => {
  it("accepts a receipt that satisfies the Shared contract", () => {
    expect(buyerAuthorityReceiptSchema(receipt())).toBe(true)
  })

  it("refuses an invalid receipt before touching the database", async () => {
    let connected = false
    const store = new PostgresBuyerAuthorityReceiptStore({
      connect: async () => {
        connected = true
        throw new Error("unreachable")
      },
    })
    for (const bad of [
      receipt({ currency: "ugx" }),
      receipt({ spend_reservation_id: "not-a-reservation" }),
      receipt({ buyer_organisation_id: "Org-1" }),
      receipt({ amount_minor: 0 }),
      { ...receipt(), extra: true } as BuyerAuthorityReceipt,
    ]) {
      await expect(store.record(bad)).rejects.toBeInstanceOf(BuyerAuthorityReceiptRefused)
    }
    expect(connected).toBe(false)
  })
})
