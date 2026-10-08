import type { MarketPaymentPolicy } from "../../payments"

export const THAMANI_PAYMENT_POLICIES: readonly MarketPaymentPolicy[] = [
  {
    marketKey: "thamani_ug",
    currency: "UGX",
    legalSellerKey: "thamani-uganda",
    defaultTerms: "PREPAID",
    allowedTerms: ["PREPAID"],
    providers: [
      {
        key: "medusa-system-ug-sandbox",
        kind: "MEDUSA_NATIVE",
        enabled: true,
        currencies: ["UGX"],
        methods: ["SELECTED_PSP"],
        capabilities: ["AUTHORIZE", "CAPTURE", "REFUND", "WEBHOOK", "RECONCILE"],
      },
      {
        key: "mtn-momo-uganda",
        kind: "REGIONAL_ADAPTER",
        enabled: false,
        currencies: ["UGX"],
        methods: ["SELECTED_PSP"],
        capabilities: ["AUTHORIZE", "CAPTURE", "REFUND", "WEBHOOK", "RECONCILE"],
      },
      {
        key: "airtel-money-uganda",
        kind: "REGIONAL_ADAPTER",
        enabled: false,
        currencies: ["UGX"],
        methods: ["SELECTED_PSP"],
        capabilities: ["AUTHORIZE", "CAPTURE", "REFUND", "WEBHOOK", "RECONCILE"],
      },
    ],
  },
  {
    marketKey: "thamani_za",
    currency: "ZAR",
    legalSellerKey: "thamani-south-africa",
    defaultTerms: "PREPAID",
    allowedTerms: ["PREPAID"],
    providers: [
      {
        key: "medusa-system-za-sandbox",
        kind: "MEDUSA_NATIVE",
        enabled: true,
        currencies: ["ZAR"],
        methods: ["SELECTED_PSP"],
        capabilities: ["AUTHORIZE", "CAPTURE", "REFUND", "WEBHOOK", "RECONCILE"],
      },
      {
        key: "peach-payments-south-africa",
        kind: "REGIONAL_ADAPTER",
        enabled: false,
        currencies: ["ZAR"],
        methods: ["SELECTED_PSP"],
        capabilities: ["AUTHORIZE", "CAPTURE", "REFUND", "WEBHOOK", "RECONCILE"],
      },
    ],
  },
] as const
