export const reconcileTax = (input: {
  commerceTaxMinor: number
  commerceCurrency: string
  erpTaxMinor?: number | null
  erpCurrency?: string | null
}) => {
  if (
    !Number.isSafeInteger(input.commerceTaxMinor) ||
    input.commerceTaxMinor < 0 ||
    !/^[A-Z]{3}$/.test(input.commerceCurrency)
  ) {
    throw new Error("Commerce tax must be exact minor units with a valid currency")
  }
  if (
    input.erpTaxMinor !== undefined &&
    input.erpTaxMinor !== null &&
    (!Number.isSafeInteger(input.erpTaxMinor) || input.erpTaxMinor < 0)
  ) {
    throw new Error("ERP tax amount is not an exact non-negative minor-unit integer")
  }
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
