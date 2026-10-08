/**
 * Gate 9 (Promotions): percentage/code-based discounting on top of Gate 6's
 * standard retail catalogue and Gate 8's scheduled sale pricing. A Medusa
 * Promotion is distinct from a Price List (ADR-0012 §31): a Price List is a
 * scheduled/segmented *price*, a Promotion is a cart-time *rule-based
 * discount* applied via a code.
 *
 * There is no ZuriBeans equivalent to fork from — B2B never built
 * Promotions — so this is a fresh, B2C-shaped boundary using Medusa's
 * native Promotion module directly (`engine-boundaries.md`: Promotions =
 * NATIVE-IN-MEDUSA, no separate Baobab Promotion Engine).
 */
export type ThamaniPromotionApplicationType = "percentage" | "fixed"

export type ThamaniPromotionConfig = {
  /** The code a customer enters at checkout. */
  code: string
  applicationType: ThamaniPromotionApplicationType
  /**
   * The Market/currency this promotion is scoped to (ADR-0012 §32: an
   * incorrectly scoped promotion is a financial defect — the same reason
   * `ThamaniPricingDecisionPort` validates currency against Market). A
   * `percentage` discount is arithmetically currency-agnostic, but is still
   * scoped here so a Uganda promotion cannot be applied to a South Africa
   * cart, matching how every other Thamani gate uses currency as the
   * Market-isolation proxy (Gate 6 prices, Gate 7 search, Gate 8 sales).
   */
  currencyCode: "ugx" | "zar"
  /** Percentage points (e.g. `10` = 10%) or a flat currency amount, per `applicationType`. */
  value: number
  /** The demonstration product this promotion is exercised against — not a targeting rule on the Promotion itself, just which product the regression fixture adds to its test cart. */
  productHandle: string
}

/**
 * Two demonstration promotions — one percentage, one fixed — enough to
 * prove both `ApplicationMethodType`s compute correctly and that the
 * Market/currency scope is enforced, without building a full campaign
 * system, buy-X-get-Y, or bundle discounts (explicitly deferred; see
 * `docs/architecture/thamani-promotions.md`).
 */
export const THAMANI_PROMOTIONS: readonly ThamaniPromotionConfig[] = [
  {
    code: "THAMANI10",
    applicationType: "percentage",
    currencyCode: "ugx",
    value: 10,
    productHandle: "thamani-instant-coffee-200g",
  },
  {
    code: "THAMANIFIXED2000",
    applicationType: "fixed",
    currencyCode: "ugx",
    value: 2_000,
    productHandle: "thamani-green-tea-100g",
  },
]

export class ThamaniPromotionCurrencyMismatchError extends Error {
  constructor(
    readonly code: string,
    readonly promotionCurrencyCode: string,
    readonly cartCurrencyCode: string,
  ) {
    super(
      `Promotion "${code}" is scoped to ${promotionCurrencyCode}, but the cart is in ${cartCurrencyCode}`,
    )
    this.name = "ThamaniPromotionCurrencyMismatchError"
  }
}

/**
 * Medusa's Promotion module does not itself refuse to compute a `fixed`
 * discount against a cart whose currency differs from the promotion's
 * `application_method.currency_code` — it would silently subtract the raw
 * numeric `value` regardless of currency, which is exactly the "incorrectly
 * scoped promotion is a financial defect" ADR-0012 §32 warns about. This
 * check must run before a promotion code is ever added to a cart.
 */
export function assertPromotionCurrencyMatchesCart(
  promotion: Pick<ThamaniPromotionConfig, "code" | "currencyCode">,
  cartCurrencyCode: string,
): void {
  if (promotion.currencyCode !== cartCurrencyCode.toLowerCase()) {
    throw new ThamaniPromotionCurrencyMismatchError(
      promotion.code,
      promotion.currencyCode,
      cartCurrencyCode,
    )
  }
}

export const findThamaniPromotionConfig = (code: string): ThamaniPromotionConfig | undefined =>
  THAMANI_PROMOTIONS.find((promotion) => promotion.code === code)

/**
 * The breadcrumb `bootstrap-thamani-market.ts` tags Thamani's Sales Channel
 * with (`findByMetadataKey(salesChannels, "baobab_sales_channel_key", ...)`,
 * matching every other Thamani gate's convention). This is the only
 * authoritative way to tell a Thamani cart from a ZuriBeans one: ZuriBeans
 * Uganda and Thamani Uganda share the same Region and the same currency
 * (UGX) — currency alone is not a Digital Estate identifier.
 */
export const THAMANI_SALES_CHANNEL_KEY = "thamani_b2c"

export class ThamaniCartEstateMismatchError extends Error {
  constructor(
    readonly code: string,
    readonly cartSalesChannelId: string | null,
  ) {
    super(
      `Promotion "${code}" is a Thamani B2C promotion — cart (sales channel ${cartSalesChannelId ?? "none"}) is not a Thamani cart`,
    )
    this.name = "ThamaniCartEstateMismatchError"
  }
}
