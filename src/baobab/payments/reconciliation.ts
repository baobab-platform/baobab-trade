import type { PaymentStatus } from "./orchestration-port"

export type PaymentReconciliationResult = {
  status: "MATCHED" | "VARIANCE" | "PENDING_ERP"
  amountDeltaMinor: number
  reasons: string[]
}

export const reconcilePaymentWithErp = (input: {
  commerceStatus: PaymentStatus
  commerceAmountMinor: number
  commerceCurrency: string
  erpStatus?: string | null
  erpAmountMinor?: number | null
  erpCurrency?: string | null
}): PaymentReconciliationResult => {
  if (!Number.isSafeInteger(input.commerceAmountMinor) || input.commerceAmountMinor <= 0) {
    throw new Error("Commerce amount must be a positive integer in minor units")
  }
  if (!input.erpStatus) {
    return {
      status: "PENDING_ERP",
      amountDeltaMinor: input.commerceAmountMinor,
      reasons: ["ERP_MISSING"],
    }
  }
  const reasons: string[] = []
  const erpAmount = input.erpAmountMinor ?? 0
  if (erpAmount !== input.commerceAmountMinor) reasons.push("AMOUNT_MISMATCH")
  if (input.erpCurrency !== input.commerceCurrency) reasons.push("CURRENCY_MISMATCH")
  if (input.erpStatus !== input.commerceStatus) reasons.push("STATUS_MISMATCH")
  return {
    status: reasons.length ? "VARIANCE" : "MATCHED",
    amountDeltaMinor: input.commerceAmountMinor - erpAmount,
    reasons,
  }
}
