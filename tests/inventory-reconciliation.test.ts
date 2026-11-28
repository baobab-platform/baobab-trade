import { describe, expect, it } from "vitest"
import {
  assertProjectionSequence,
  inventoryReconciliationColumns,
  reconcileInventory,
} from "../src/baobab/inventory"

describe("ERP inventory projection reconciliation", () => {
  const matched = { erpOnHand: 120, medusaStocked: 120, medusaReserved: 7, medusaAvailable: 101 }

  it("reports a matched projection and preserves the native ATS", () => {
    expect(reconcileInventory(matched)).toEqual({
      erpOnHand: "120",
      medusaStocked: "120",
      medusaReserved: "7",
      medusaAvailable: "101",
      delta: "0",
      status: "MATCHED",
    })
  })

  it("surfaces stock variance instead of silently overwriting it", () => {
    expect(
      reconcileInventory({ ...matched, medusaStocked: 117, medusaAvailable: 105 }),
    ).toMatchObject({
      delta: "-3",
      medusaAvailable: "105",
      status: "VARIANCE",
    })
  })

  it("rejects negative or missing native availability", () => {
    expect(() => reconcileInventory({ ...matched, medusaAvailable: -1 })).toThrow("medusaAvailable")
    expect(() => reconcileInventory({ ...matched, medusaAvailable: "NaN" })).toThrow(
      "medusaAvailable",
    )
  })

  it("stores exact integer projection fields and refuses quantities the bridge cannot represent", () => {
    expect(inventoryReconciliationColumns(reconcileInventory(matched))).toMatchObject({
      erp_on_hand_quantity: 120,
      medusa_stocked_quantity: 120,
      medusa_reserved_quantity: 7,
      delta_quantity: 0,
    })
    for (const erpOnHand of ["120.5", "2147483648"]) {
      expect(() =>
        inventoryReconciliationColumns(reconcileInventory({ ...matched, erpOnHand })),
      ).toThrow("integer storage range")
    }
  })

  it("rejects stale and replayed ERP projection sequences", () => {
    expect(() => assertProjectionSequence(8, 8)).toThrow("Stale or replayed")
    expect(() => assertProjectionSequence(8, 7)).toThrow("Stale or replayed")
    expect(() => assertProjectionSequence(8, 9)).not.toThrow()
  })
})
