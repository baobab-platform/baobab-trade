import { describe, expect, it } from "vitest"
import { assertProjectionSequence, reconcileInventory } from "../src/baobab/inventory"

describe("ERP inventory projection reconciliation", () => {
  it("reports a matched projection and commerce ATS after reservations", () => {
    expect(reconcileInventory({ erpOnHand: 120, medusaStocked: 120, medusaReserved: 7 })).toEqual({
      erpOnHand: 120,
      medusaStocked: 120,
      medusaReserved: 7,
      delta: 0,
      availableToSell: 113,
      status: "MATCHED",
    })
  })

  it("surfaces stock variance instead of silently overwriting it", () => {
    expect(
      reconcileInventory({ erpOnHand: 120, medusaStocked: 117, medusaReserved: 2 }),
    ).toMatchObject({ delta: -3, availableToSell: 115, status: "VARIANCE" })
  })

  it("never exposes negative available-to-sell", () => {
    expect(
      reconcileInventory({ erpOnHand: 4, medusaStocked: 4, medusaReserved: 6 }).availableToSell,
    ).toBe(0)
  })

  it("rejects negative or fractional inventory facts", () => {
    expect(() =>
      reconcileInventory({ erpOnHand: -1, medusaStocked: 0, medusaReserved: 0 }),
    ).toThrow("non-negative integer")
    expect(() =>
      reconcileInventory({ erpOnHand: 1.5, medusaStocked: 0, medusaReserved: 0 }),
    ).toThrow("non-negative integer")
  })

  it("rejects stale and replayed ERP projection sequences", () => {
    expect(() => assertProjectionSequence(8, 8)).toThrow("Stale or replayed")
    expect(() => assertProjectionSequence(8, 7)).toThrow("Stale or replayed")
    expect(() => assertProjectionSequence(8, 9)).not.toThrow()
  })
})
