export const reconcileTax = (input: {
  commerceTaxMinor: number
  commerceCurrency: string
  erpTaxMinor?: number | null
  erpCurrency?: string | null
}) => {
  if (input.erpTaxMinor == null)
    return {
      status: "PENDING_ERP" as const,
      deltaMinor: input.commerceTaxMinor,
      reasons: ["ERP_TAX_MISSING"],
    }
  const reasons: string[] = []
  if (input.erpTaxMinor !== input.commerceTaxMinor) reasons.push("AMOUNT_MISMATCH")
  if (input.erpCurrency !== input.commerceCurrency) reasons.push("CURRENCY_MISMATCH")
  return {
    status: reasons.length ? ("VARIANCE" as const) : ("MATCHED" as const),
    deltaMinor: input.commerceTaxMinor - input.erpTaxMinor,
    reasons,
  }
}
