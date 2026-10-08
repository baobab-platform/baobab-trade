/**
 * Data-driven Thamani B2C launch Market configuration.
 *
 * Thamani is a distinct Baobab Digital Estate from ZuriBeans B2B, not a
 * second storefront against the same commercial model. It therefore gets
 * its own candidate market keys (`thamani_ug`, `thamani_za`, as opposed to
 * `zuribeans_ug`/`zuribeans_za`), its own principal Sales Channel
 * (`thamani_b2c`), and its own Stock Locations — even though both estates
 * are projected from the same underlying Baobab Uganda and South Africa
 * Markets and run on this same Trade engine instance.
 *
 * As with ZuriBeans, no Baobab Market instance exists yet in the Control
 * Plane for these keys (see market-config.ts and
 * docs/architecture/market-model.md). These `marketKey` values are candidate
 * `canonical_key`s pending Control Plane registration, and no external
 * production provider has been approved for either Market: payment and
 * shipping bind Medusa's built-in providers explicitly. Do not invent
 * provider credentials here. `shipping.shippingOption.amount` is a
 * deliberate exception — see `market-config.ts`'s own doc comment on that
 * field for why a placeholder amount is unavoidable.
 *
 * Tax is the one exception: `tp_thamani_effective_dated` (Gate 13,
 * `src/modules/thamani-tax-provider/`) wraps Baobab's own sourced,
 * effective-dated GOODS VAT rules (`THAMANI_STANDARD_TAX_RULES`) — real
 * government rates with legal-authority provenance, not an external
 * production integration. It is scoped to Thamani carts only via
 * `src/workflows/thamani-tax-guard.ts`; ZuriBeans keeps `tp_system` and this
 * provider replicates that same native behaviour for any cart it cannot
 * positively identify as Thamani's, so ZuriBeans' tax computation never
 * changes even though both estates share one Tax Region per country.
 *
 * Gate 4 provisions one primary Stock Location per Market, matching the
 * ZuriBeans pattern. The additional Thamani facilities described in the
 * implementation brief (e.g. a second Uganda import-staging location, and
 * Cape Town/Johannesburg/Durban in South Africa) are explicitly deferred to
 * Gate 10 (Inventory), which is out of scope for this foundation slice.
 */
import type { MarketBootstrapConfig } from "./market-config"

export const THAMANI_UGANDA: MarketBootstrapConfig = {
  marketKey: "thamani_ug",
  displayName: "Thamani Uganda",
  countryCode: "UG",
  defaultCurrency: "UGX",
  allowedCurrencies: ["UGX"],
  salesChannel: { key: "thamani_b2c", name: "Thamani B2C" },
  stockLocation: {
    key: "thamani_ug_kla_01",
    name: "Kampala Central Warehouse (UG-KLA-01, development placeholder)",
    addressLine: "Development placeholder address — not a real warehouse",
    city: "Kampala",
  },
  payment: { mode: "NATIVE", providerIds: ["pp_system_default"] },
  shipping: {
    mode: "NATIVE",
    providerIds: ["manual_manual"],
    fulfillmentSet: {
      key: "thamani_ug_shipping",
      name: "Thamani Uganda Shipping",
      type: "shipping",
    },
    serviceZone: {
      key: "thamani_ug_domestic",
      name: "Thamani Uganda Domestic",
      countryCode: "UG",
    },
    shippingOption: {
      key: "thamani_ug_standard_shipping",
      name: "Thamani Uganda Standard Shipping (development placeholder rate)",
      amount: 5_000,
    },
  },
  tax: {
    mode: "NATIVE",
    providerId: "tp_thamani_effective_dated",
    automaticTaxes: true,
    pricesIncludeTax: true,
    policyReference: "control-plane:thamani_ug:tax",
  },
}

export const THAMANI_SOUTH_AFRICA: MarketBootstrapConfig = {
  marketKey: "thamani_za",
  displayName: "Thamani South Africa",
  countryCode: "ZA",
  defaultCurrency: "ZAR",
  allowedCurrencies: ["ZAR"],
  salesChannel: { key: "thamani_b2c", name: "Thamani B2C" },
  stockLocation: {
    key: "thamani_za_cpt_01",
    name: "Cape Town Distribution Warehouse (ZA-CPT-01, development placeholder)",
    addressLine: "Development placeholder address — not a real warehouse",
    city: "Cape Town",
  },
  payment: { mode: "NATIVE", providerIds: ["pp_system_default"] },
  shipping: {
    mode: "NATIVE",
    providerIds: ["manual_manual"],
    fulfillmentSet: {
      key: "thamani_za_shipping",
      name: "Thamani South Africa Shipping",
      type: "shipping",
    },
    serviceZone: {
      key: "thamani_za_domestic",
      name: "Thamani South Africa Domestic",
      countryCode: "ZA",
    },
    shippingOption: {
      key: "thamani_za_standard_shipping",
      name: "Thamani South Africa Standard Shipping (development placeholder rate)",
      amount: 50,
    },
  },
  tax: {
    mode: "NATIVE",
    providerId: "tp_thamani_effective_dated",
    automaticTaxes: true,
    pricesIncludeTax: true,
    policyReference: "control-plane:thamani_za:tax",
  },
}

export const THAMANI_LAUNCH_MARKETS: readonly MarketBootstrapConfig[] = [
  THAMANI_UGANDA,
  THAMANI_SOUTH_AFRICA,
]

export const getThamaniMarketBootstrapConfig = (marketKey: string): MarketBootstrapConfig => {
  const config = THAMANI_LAUNCH_MARKETS.find((market) => market.marketKey === marketKey)
  if (!config) {
    const known = THAMANI_LAUNCH_MARKETS.map((market) => market.marketKey).join(", ")
    throw new Error(`Unknown Thamani market bootstrap key "${marketKey}". Known keys: ${known}`)
  }
  return config
}
