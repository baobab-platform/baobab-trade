export type InventoryReconciliationInput = {
  erpOnHand: number
  medusaStocked: number
  medusaReserved: number
}

export type InventoryReconciliationResult = InventoryReconciliationInput & {
  delta: number
  availableToSell: number
  status: "MATCHED" | "VARIANCE"
}

export const reconcileInventory = (
  input: InventoryReconciliationInput,
): InventoryReconciliationResult => {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`${name} must be a non-negative integer`)
  }
  const delta = input.medusaStocked - input.erpOnHand
  return {
    ...input,
    delta,
    availableToSell: Math.max(0, input.medusaStocked - input.medusaReserved),
    status: delta === 0 ? "MATCHED" : "VARIANCE",
  }
}

export const assertProjectionSequence = (
  currentSequence: number | null,
  incomingSequence: number,
) => {
  if (!Number.isInteger(incomingSequence) || incomingSequence <= 0) {
    throw new Error("ERP projection sequence must be a positive integer")
  }
  if (currentSequence !== null && incomingSequence <= currentSequence) {
    throw new Error("Stale or replayed ERP inventory projection")
  }
}
