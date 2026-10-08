import { describe, expect, it } from "vitest"
import {
  assertActiveBuyerContext,
  assertApprovalAuthority,
  B2BAuthorizationError,
  decidePurchase,
  type BuyerContext,
} from "../src/baobab/b2b"

const buyer: BuyerContext = {
  principalId: "principal-alice",
  customerId: "cus-alice",
  organisationId: "org-x",
  membershipId: "membership-x",
  membershipStatus: "ACTIVE",
  roles: ["BUYER"],
}

describe("B2B organisation authorization", () => {
  it("rejects cross-organisation use of a valid membership", () => {
    expect(() => assertActiveBuyerContext(buyer, "org-y")).toThrowError(
      expect.objectContaining({ code: "ORGANISATION_MISMATCH" }),
    )
  })

  it.each(["INVITED", "SUSPENDED", "REVOKED"] as const)(
    "rejects a %s membership",
    (membershipStatus) => {
      expect(() => assertActiveBuyerContext({ ...buyer, membershipStatus }, "org-x")).toThrowError(
        expect.objectContaining({ code: "INACTIVE_MEMBERSHIP" }),
      )
    },
  )

  it("requires a durable customer PO reference when organisation policy requires one", () => {
    expect(() =>
      decidePurchase(
        buyer,
        {
          spendLimitMinor: 100_000,
          approvalThresholdMinor: 50_000,
          approverLimitMinor: null,
          purchaseOrderRequired: true,
        },
        10_000,
      ),
    ).toThrowError(expect.objectContaining({ code: "PO_NUMBER_REQUIRED" }))
  })

  it("routes a purchase above the threshold to approval without creating an order", () => {
    expect(
      decidePurchase(
        buyer,
        {
          spendLimitMinor: 100_000,
          approvalThresholdMinor: 50_000,
          approverLimitMinor: null,
          purchaseOrderRequired: true,
        },
        75_000,
        "PO-2026-0042",
      ),
    ).toEqual({ outcome: "REQUIRE_APPROVAL", reason: "THRESHOLD" })
  })

  it("allows an authorised purchase within policy", () => {
    expect(
      decidePurchase(
        buyer,
        {
          spendLimitMinor: 100_000,
          approvalThresholdMinor: 50_000,
          approverLimitMinor: null,
          purchaseOrderRequired: false,
        },
        25_000,
      ),
    ).toEqual({ outcome: "PLACE_ORDER" })
  })

  it("enforces organisation-specific approver limits", () => {
    const approver: BuyerContext = { ...buyer, roles: ["APPROVER"] }
    expect(() => assertApprovalAuthority(approver, "org-x", 120_000, 100_000)).toThrowError(
      B2BAuthorizationError,
    )
  })
})
