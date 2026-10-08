export type ReturnReason = "DAMAGED" | "WRONG_ITEM" | "NOT_AS_DESCRIBED" | "CUSTOMER_REMORSE"

export const assertReturnRequest = (input: {
  quantity: number
  fulfilledQuantity: number
  alreadyReturnedQuantity: number
  reason: ReturnReason
}): void => {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0)
    throw new Error("Return quantity must be a positive integer")
  if (input.quantity + input.alreadyReturnedQuantity > input.fulfilledQuantity)
    throw new Error("Return exceeds the remaining fulfilled quantity")
}
