export type PaymentMethod = "BANK_TRANSFER" | "MANUAL_SETTLEMENT" | "INVOICE_TERMS" | "SELECTED_PSP"

export type PaymentTerms = "PREPAID" | "DUE_ON_RECEIPT" | "NET_7" | "NET_14" | "NET_30"

export type PaymentProviderBinding = {
  key: string
  kind: "MEDUSA_NATIVE" | "REGIONAL_ADAPTER"
  enabled: boolean
  currencies: readonly string[]
  methods: readonly PaymentMethod[]
  capabilities?: readonly ("AUTHORIZE" | "CAPTURE" | "REFUND" | "WEBHOOK" | "RECONCILE")[]
}

export type MarketPaymentPolicy = {
  marketKey: string
  currency: "UGX" | "ZAR"
  legalSellerKey: string
  defaultTerms: PaymentTerms
  allowedTerms: readonly PaymentTerms[]
  providers: readonly PaymentProviderBinding[]
}

export const ZURIBEANS_PAYMENT_POLICIES: readonly MarketPaymentPolicy[] = [
  {
    marketKey: "zuribeans-ug",
    currency: "UGX",
    legalSellerKey: "zuribeans-uganda",
    defaultTerms: "PREPAID",
    allowedTerms: ["PREPAID", "DUE_ON_RECEIPT", "NET_7", "NET_14", "NET_30"],
    providers: [
      {
        key: "medusa-manual-ug",
        kind: "MEDUSA_NATIVE",
        enabled: true,
        currencies: ["UGX"],
        methods: ["BANK_TRANSFER", "MANUAL_SETTLEMENT", "INVOICE_TERMS"],
      },
      {
        key: "mtn-momo-uganda",
        kind: "REGIONAL_ADAPTER",
        enabled: false,
        currencies: ["UGX"],
        methods: ["SELECTED_PSP"],
      },
    ],
  },
  {
    marketKey: "zuribeans-za",
    currency: "ZAR",
    legalSellerKey: "zuribeans-south-africa",
    defaultTerms: "PREPAID",
    allowedTerms: ["PREPAID", "DUE_ON_RECEIPT", "NET_7", "NET_14", "NET_30"],
    providers: [
      {
        key: "medusa-manual-za",
        kind: "MEDUSA_NATIVE",
        enabled: true,
        currencies: ["ZAR"],
        methods: ["BANK_TRANSFER", "MANUAL_SETTLEMENT", "INVOICE_TERMS"],
      },
      {
        key: "peach-payments-south-africa",
        kind: "REGIONAL_ADAPTER",
        enabled: false,
        currencies: ["ZAR"],
        methods: ["SELECTED_PSP"],
      },
    ],
  },
] as const

export const resolvePaymentProvider = (
  policy: MarketPaymentPolicy,
  method: PaymentMethod,
  currency: string,
): PaymentProviderBinding => {
  if (currency !== policy.currency) throw new Error("Payment currency is not valid for the Market")
  const provider = policy.providers.find(
    (candidate) =>
      candidate.enabled &&
      candidate.currencies.includes(currency) &&
      candidate.methods.includes(method),
  )
  if (!provider) throw new Error("No enabled payment provider supports this Market and method")
  return provider
}
