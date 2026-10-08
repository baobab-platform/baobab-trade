export type FulfilmentAllocation = {
  orderLineReference: string
  sourceLocationKey: string
  quantity: number
}

export const assertCompleteAllocation = (
  ordered: Readonly<Record<string, number>>,
  allocations: readonly FulfilmentAllocation[],
): void => {
  const totals = new Map<string, number>()
  for (const allocation of allocations) {
    if (!Number.isInteger(allocation.quantity) || allocation.quantity <= 0)
      throw new Error("Allocation quantity must be a positive integer")
    totals.set(
      allocation.orderLineReference,
      (totals.get(allocation.orderLineReference) ?? 0) + allocation.quantity,
    )
  }
  for (const [line, quantity] of Object.entries(ordered))
    if (totals.get(line) !== quantity)
      throw new Error(`Allocation does not fully cover order line ${line}`)
  if ([...totals.keys()].some((line) => !(line in ordered)))
    throw new Error("Allocation contains an unknown order line")
}
