import type { BigNumberInput } from "@medusajs/framework/types"
import { MathBN } from "@medusajs/framework/utils"

export type InventoryReconciliationInput = {
  erpOnHand: BigNumberInput
  medusaStocked: BigNumberInput
  medusaReserved: BigNumberInput
  // Supplied by Medusa; never derive this from stocked minus reserved.
  medusaAvailable: BigNumberInput
}

export type InventoryReconciliationResult = {
  erpOnHand: string
  medusaStocked: string
  medusaReserved: string
  medusaAvailable: string
  delta: string
  status: "MATCHED" | "VARIANCE"
}

const exactNonNegativeQuantity = (value: BigNumberInput, name: string): string => {
  try {
    const quantity = MathBN.convert(value)
    if (!quantity.isFinite() || quantity.isNegative()) {
      throw new Error("invalid")
    }
    return quantity.toFixed()
  } catch {
    throw new Error(`${name} must be a non-negative exact quantity`)
  }
}

export const reconcileInventory = (
  input: InventoryReconciliationInput,
): InventoryReconciliationResult => {
  const erpOnHand = exactNonNegativeQuantity(input.erpOnHand, "erpOnHand")
  const medusaStocked = exactNonNegativeQuantity(input.medusaStocked, "medusaStocked")
  const medusaReserved = exactNonNegativeQuantity(input.medusaReserved, "medusaReserved")
  const medusaAvailable = exactNonNegativeQuantity(input.medusaAvailable, "medusaAvailable")
  const delta = MathBN.sub(medusaStocked, erpOnHand)

  return {
    erpOnHand,
    medusaStocked,
    medusaReserved,
    medusaAvailable,
    delta: delta.toFixed(),
    status: MathBN.eq(delta, 0) ? "MATCHED" : "VARIANCE",
  }
}

export const assertProjectionSequence = (
  currentSequence: number | null,
  incomingSequence: number,
) => {
  if (!Number.isSafeInteger(incomingSequence) || incomingSequence <= 0) {
    throw new Error("ERP projection sequence must be a positive integer")
  }
  if (
    currentSequence !== null &&
    (!Number.isSafeInteger(currentSequence) ||
      currentSequence < 1 ||
      incomingSequence <= currentSequence)
  ) {
    throw new Error("Stale or replayed ERP inventory projection")
  }
}
