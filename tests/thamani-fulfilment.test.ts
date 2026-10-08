import { describe, expect, it } from "vitest"
import { resolveFulfilmentProvider } from "../src/baobab/fulfilment"
import {
  THAMANI_FULFILMENT_POLICIES,
  assertCompleteAllocation,
  assertReturnRequest,
} from "../src/baobab/thamani/fulfilment"

describe("Thamani Gate 12 fulfilment", () => {
  it("supports delivery, parcel and pickup in both Markets", () => {
    for (const policy of THAMANI_FULFILMENT_POLICIES)
      for (const mode of ["LOCAL_DELIVERY", "PARCEL_SHIPMENT", "CUSTOMER_COLLECTION"] as const)
        expect(resolveFulfilmentProvider(policy, mode).enabled).toBe(true)
  })
  it("keeps unapproved courier adapters disabled", () => {
    const external = THAMANI_FULFILMENT_POLICIES.flatMap((policy) => policy.providers).filter(
      (provider) => provider.kind === "THIRD_PARTY",
    )
    expect(external.every((provider) => !provider.enabled)).toBe(true)
  })
  it("validates complete multi-location partial allocations", () => {
    expect(() =>
      assertCompleteAllocation({ a: 3 }, [
        { orderLineReference: "a", sourceLocationKey: "one", quantity: 1 },
        { orderLineReference: "a", sourceLocationKey: "two", quantity: 2 },
      ]),
    ).not.toThrow()
    expect(() =>
      assertCompleteAllocation({ a: 3 }, [
        { orderLineReference: "a", sourceLocationKey: "one", quantity: 2 },
      ]),
    ).toThrow("fully cover")
  })
  it("prevents returns beyond fulfilled quantity", () => {
    expect(() =>
      assertReturnRequest({
        quantity: 1,
        fulfilledQuantity: 2,
        alreadyReturnedQuantity: 1,
        reason: "DAMAGED",
      }),
    ).not.toThrow()
    expect(() =>
      assertReturnRequest({
        quantity: 2,
        fulfilledQuantity: 2,
        alreadyReturnedQuantity: 1,
        reason: "DAMAGED",
      }),
    ).toThrow("exceeds")
  })
})
