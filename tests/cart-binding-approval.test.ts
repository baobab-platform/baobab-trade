import { describe, expect, it } from "vitest"
import { assertIndependentlyApprovedBinding } from "../src/baobab/orders/cart-binding-approval"

const now = Date.parse("2026-10-10T02:00:00.000Z")
const base = {
  cartId: "cart-synthetic-1",
  proposedBy: "human-maker-synthetic",
  proposedAt: new Date(now - 60_000).toISOString(),
  approvedBy: "human-checker-synthetic",
  approvedAt: new Date(now - 30_000).toISOString(),
  approvalReference: "cp/evidence/independent-review/synthetic",
  approvalScope: "SELLER_OF_RECORD_CART_BINDING",
  expiresAt: new Date(now + 30_000).toISOString(),
}

describe("LA-05C3 maker/checker evidence", () => {
  it("accepts distinct timely evidence without claiming current CP trading permission", () => {
    expect(() => assertIndependentlyApprovedBinding(base, now)).not.toThrow()
  })

  it("rejects missing reviewer, same human, invalid approval scope and stale record", () => {
    for (const value of [
      { approvedBy: "" },
      { approvedBy: base.proposedBy },
      { proposedBy: "" },
      { approvalScope: "TENANT_DEFAULT_LEGAL_ENTITY" },
      { approvalReference: "" },
      { approvedAt: new Date(now + 60_000).toISOString() },
      { proposedAt: new Date(now + 60_000).toISOString() },
      { expiresAt: new Date(now).toISOString() },
    ]) {
      expect(() => assertIndependentlyApprovedBinding({ ...base, ...value }, now)).toThrow(
        "independent maker/checker approval",
      )
    }
  })
})
