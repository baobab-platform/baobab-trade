/**
 * Data-driven ZuriBeans launch Market configuration. No Baobab Market
 * instance exists yet in the Control Plane for these keys — see
 * nabhold/shared contracts/legal-entity/registry.yaml, where the ZURIBEANS
 * entity's `markets` list is still empty pending Control Plane approval.
 *
 * These `marketKey` values are candidate `canonical_key`s (see
 * contracts/control-plane/v1/market.schema.json). They let Trade provision
 * its own Medusa-side commerce projection (Region, Sales Channel, Stock
 * Location) ahead of that approval, without inventing a `market_id`: once
 * Control Plane registers and activates the real Market, the resulting
 * `market_id` must be reconciled against the `baobab_market_key` tag this
 * bootstrap leaves on each Medusa record (see src/baobab/market/mapping.ts).
 *
 * No external production provider has been approved for either Market.
 * Payment, tax, and shipping therefore bind Medusa's built-in providers
 * explicitly. Do not invent provider credentials or tax rates here. The one
 * deliberate exception is `shipping.shippingOption.amount`: Medusa cannot
 * complete a checkout without a real, priced `ShippingOption` on the
 * service zone, and the bound `manual_manual` provider has no
 * calculated-pricing fallback — see the field's own doc comment below.
 */
export type ProviderMode = "NATIVE" | "EXTERNAL" | "DISABLED"

export type MarketBootstrapConfig = {
  /** Candidate canonical_key once registered with Control Plane. */
  marketKey: string
  displayName: string
  /** ISO 3166-1 alpha-2, uppercase per market.schema.json `default_country`. */
  countryCode: string
  /** ISO 4217, uppercase per market.schema.json `default_currency`. */
  defaultCurrency: string
  allowedCurrencies: readonly string[]
  salesChannel: { key: string; name: string }
  stockLocation: {
    key: string
    name: string
    addressLine: string
    city: string
  }
  payment: { mode: ProviderMode; providerIds: readonly string[] }
  shipping: {
    mode: ProviderMode
    providerIds: readonly string[]
    fulfillmentSet: { key: string; name: string; type: "shipping" }
    serviceZone: { key: string; name: string; countryCode: string }
    /**
     * A cart cannot complete checkout (`completeCartWorkflow`'s
     * `validate-shipping` step) without a real `ShippingOption` on the
     * service zone above, and `manual_manual` (this Market's only bound
     * shipping provider) has no calculated-pricing support — Medusa requires
     * a `price_type: "flat"` option to carry an actual amount, there is no
     * zero-config fallback the way tax has (0% when no rate row exists). So
     * `amount` is a placeholder, not a sourced rate: it exists only to
     * unblock checkout mechanically, the same way `stockLocation.addressLine`
     * above is a placeholder address, not a real warehouse. Do not treat it
     * as an approved shipping price. Same major-currency-unit scale as
     * `RetailPrice.standardAmount` (catalogue-config.ts) — e.g. `2_000` means
     * UGX 2,000, not 2,000 minor units.
     */
    shippingOption: { key: string; name: string; amount: number }
  }
  tax: {
    mode: ProviderMode
    providerId: string
    automaticTaxes: boolean
    /**
     * Whether a variant's stored price is the final, tax-inclusive customer
     * price (so tax is carved out of it) rather than a net price tax gets
     * added on top of. Provisioned as a `PricePreference` scoped to this
     * Market's Region (see `provisioning.ts`) — only when `true`; `false`
     * leaves Medusa's own tax-exclusive default untouched.
     */
    pricesIncludeTax: boolean
    policyReference: string
  }
}

export const toMedusaCurrencyCode = (isoCurrencyCode: string): string =>
  isoCurrencyCode.toLowerCase()

export type StoreSupportedCurrency = { currency_code: string; is_default: boolean }

/**
 * Computes the supported-currency list to write back to a Store after adding
 * one new currency. A Medusa Store must always have exactly one default
 * currency (`StoreModuleService.validateCreateRequest`), so the first
 * currency ever added to a store with none yet has to become the default;
 * once a default exists, a newly added currency must never displace it.
 */
export const withAddedStoreCurrency = (
  existingCurrencies: readonly StoreSupportedCurrency[],
  newCurrencyCode: string,
): StoreSupportedCurrency[] => {
  const hasDefault = existingCurrencies.some((currency) => currency.is_default)
  return [
    ...existingCurrencies.map((currency) => ({
      currency_code: currency.currency_code,
      is_default: currency.is_default,
    })),
    { currency_code: newCurrencyCode, is_default: !hasDefault },
  ]
}

export const ZURIBEANS_UGANDA: MarketBootstrapConfig = {
  marketKey: "zuribeans_ug",
  displayName: "ZuriBeans Uganda",
  countryCode: "UG",
  defaultCurrency: "UGX",
  allowedCurrencies: ["UGX"],
  salesChannel: { key: "zuribeans_b2b", name: "ZuriBeans B2B" },
  stockLocation: {
    key: "zuribeans_ug_primary",
    name: "ZuriBeans Uganda Distribution (development placeholder)",
    addressLine: "Development placeholder address — not a real warehouse",
    city: "Kampala",
  },
  payment: { mode: "NATIVE", providerIds: ["pp_system_default"] },
  shipping: {
    mode: "NATIVE",
    providerIds: ["manual_manual"],
    fulfillmentSet: {
      key: "zuribeans_ug_shipping",
      name: "ZuriBeans Uganda Shipping",
      type: "shipping",
    },
    serviceZone: {
      key: "zuribeans_ug_domestic",
      name: "Uganda Domestic",
      countryCode: "UG",
    },
    shippingOption: {
      key: "zuribeans_ug_standard_shipping",
      name: "ZuriBeans Uganda Standard Shipping (development placeholder rate)",
      amount: 5_000,
    },
  },
  tax: {
    mode: "NATIVE",
    providerId: "tp_system",
    automaticTaxes: true,
    pricesIncludeTax: false,
    policyReference: "control-plane:zuribeans_ug:tax",
  },
}

export const ZURIBEANS_SOUTH_AFRICA: MarketBootstrapConfig = {
  marketKey: "zuribeans_za",
  displayName: "ZuriBeans South Africa",
  countryCode: "ZA",
  defaultCurrency: "ZAR",
  allowedCurrencies: ["ZAR"],
  salesChannel: { key: "zuribeans_b2b", name: "ZuriBeans B2B" },
  stockLocation: {
    key: "zuribeans_za_primary",
    name: "ZuriBeans South Africa Distribution (development placeholder)",
    addressLine: "Development placeholder address — not a real warehouse",
    city: "Johannesburg",
  },
  payment: { mode: "NATIVE", providerIds: ["pp_system_default"] },
  shipping: {
    mode: "NATIVE",
    providerIds: ["manual_manual"],
    fulfillmentSet: {
      key: "zuribeans_za_shipping",
      name: "ZuriBeans South Africa Shipping",
      type: "shipping",
    },
    serviceZone: {
      key: "zuribeans_za_domestic",
      name: "South Africa Domestic",
      countryCode: "ZA",
    },
    shippingOption: {
      key: "zuribeans_za_standard_shipping",
      name: "ZuriBeans South Africa Standard Shipping (development placeholder rate)",
      amount: 50,
    },
  },
  tax: {
    mode: "NATIVE",
    providerId: "tp_system",
    automaticTaxes: true,
    pricesIncludeTax: false,
    policyReference: "control-plane:zuribeans_za:tax",
  },
}

export const ZURIBEANS_LAUNCH_MARKETS: readonly MarketBootstrapConfig[] = [
  ZURIBEANS_UGANDA,
  ZURIBEANS_SOUTH_AFRICA,
]

export const getMarketBootstrapConfig = (marketKey: string): MarketBootstrapConfig => {
  const config = ZURIBEANS_LAUNCH_MARKETS.find((market) => market.marketKey === marketKey)
  if (!config) {
    const known = ZURIBEANS_LAUNCH_MARKETS.map((market) => market.marketKey).join(", ")
    throw new Error(`Unknown market bootstrap key "${marketKey}". Known keys: ${known}`)
  }
  return config
}
