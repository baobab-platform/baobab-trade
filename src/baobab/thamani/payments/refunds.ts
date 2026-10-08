export type RefundReason = "CUSTOMER_RETURN" | "ORDER_CANCELLATION" | "SERVICE_RECOVERY"
export type RefundStatus = "REQUESTED" | "SUBMITTED" | "SUCCEEDED" | "FAILED"

export const assertRefundRequest = (input: {
  amountMinor: number
  capturedAmountMinor: number
  alreadyRefundedMinor: number
  currency: string
  paymentCurrency: string
  reason: RefundReason
}): void => {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new Error("Refund amount must be a positive integer in minor units")
  if (input.currency !== input.paymentCurrency) throw new Error("Refund currency mismatch")
  if (input.amountMinor + input.alreadyRefundedMinor > input.capturedAmountMinor)
    throw new Error("Refund exceeds the remaining captured amount")
}
