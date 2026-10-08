/**
 * Gate 8 (Retail Pricing): scheduled sale pricing on top of the Gate 6
 * standard retail catalogue. Market-specific pricing was already
 * established in Gate 6 — every product has independent UGX and ZAR
 * amounts, never one derived from the other by FX (spec §29) — so Gate 8
 * adds only the effective-dated SALE dimension.
 *
 * A sale's actual `starts_at`/`ends_at` are computed relative to wall-clock
 * time at bootstrap time (`resolveSaleWindow`), not hardcoded literal dates
 * that would go stale. `windowKind` is the stable fact this config declares;
 * `resolveSaleWindow` and `isSaleActive` are pure and take an injectable
 * `now` so their date arithmetic is unit-testable without a live clock.
 */
export type SaleWindowKind = "ACTIVE" | "UPCOMING" | "EXPIRED"

export type SalePrice = {
  currencyCode: "ugx" | "zar"
  saleAmount: number
}

export type ThamaniSaleConfig = {
  /** The catalogue product this scheduled sale applies to, by handle. */
  productHandle: string
  windowKind: SaleWindowKind
  prices: readonly SalePrice[]
}

const DAY_MS = 24 * 60 * 60 * 1000

export type ResolvedSaleWindow = {
  startsAt: Date
  endsAt: Date
}

/**
 * Computes concrete `starts_at`/`ends_at` bounds for a sale window kind,
 * relative to `now`. `ACTIVE` always contains `now`; `UPCOMING` always
 * starts after it; `EXPIRED` always ended before it — so re-running the
 * bootstrap on any date keeps each demonstration sale in its intended state.
 */
export function resolveSaleWindow(
  kind: SaleWindowKind,
  now: Date = new Date(),
): ResolvedSaleWindow {
  const nowMs = now.getTime()
  switch (kind) {
    case "ACTIVE":
      return { startsAt: new Date(nowMs - DAY_MS), endsAt: new Date(nowMs + 90 * DAY_MS) }
    case "UPCOMING":
      return { startsAt: new Date(nowMs + 30 * DAY_MS), endsAt: new Date(nowMs + 60 * DAY_MS) }
    case "EXPIRED":
      return { startsAt: new Date(nowMs - 90 * DAY_MS), endsAt: new Date(nowMs - DAY_MS) }
  }
}

export function isSaleActive(kind: SaleWindowKind): boolean {
  return kind === "ACTIVE"
}

/**
 * Three representative products, one per window state, spanning different
 * categories — enough to prove effective-dating without building a
 * promotions campaign (Gate 9 scope, not this one).
 */
export const THAMANI_SALES: readonly ThamaniSaleConfig[] = [
  {
    productHandle: "thamani-uganda-arabica-ground-coffee-250g",
    windowKind: "ACTIVE",
    prices: [
      { currencyCode: "ugx", saleAmount: 15_000 },
      { currencyCode: "zar", saleAmount: 120 },
    ],
  },
  {
    productHandle: "thamani-dark-chocolate-70-100g",
    windowKind: "UPCOMING",
    prices: [
      { currencyCode: "ugx", saleAmount: 12_000 },
      { currencyCode: "zar", saleAmount: 95 },
    ],
  },
  {
    productHandle: "thamani-body-lotion-400ml",
    windowKind: "EXPIRED",
    prices: [
      { currencyCode: "ugx", saleAmount: 19_000 },
      { currencyCode: "zar", saleAmount: 155 },
    ],
  },
]

export const THAMANI_SALE_WINDOW_KINDS: readonly SaleWindowKind[] = [
  "ACTIVE",
  "UPCOMING",
  "EXPIRED",
]

export const salePriceListKey = (kind: SaleWindowKind): string =>
  `thamani_sale_${kind.toLowerCase()}`
