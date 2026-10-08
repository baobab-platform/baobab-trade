import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createRegionsWorkflow,
  createShippingOptionsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateRegionsWorkflow,
} from "@medusajs/core-flows"
import type {
  ExecArgs,
  IFulfillmentModuleService,
  IPricingModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
  IStoreModuleService,
  ITaxModuleService,
  RemoteQueryFunction,
} from "@medusajs/framework/types"
import {
  toMedusaCurrencyCode,
  withAddedStoreCurrency,
  type MarketBootstrapConfig,
} from "./market-config"
import {
  findByCountryCode,
  findByMarketKey,
  findByMetadataKey,
  regionMappingTag,
  salesChannelProjectionTag,
  stockLocationMappingTag,
} from "./mapping"
import { createStructuredLogger } from "../logging/logger"

const logger = createStructuredLogger("bootstrap-market")

/**
 * Idempotently provisions the Medusa-side commerce projection for one Baobab
 * launch Market (Region, Sales Channel, Stock Location, and Store currency
 * support). Safe to re-run: existing records are detected by the
 * `baobab_market_key` metadata tag and left untouched.
 *
 * Shared across Digital Estates (ZuriBeans B2B, Thamani B2C, and any future
 * estate) because the provisioning mechanics are estate-agnostic — only the
 * `MarketBootstrapConfig` values differ. This does NOT register anything with
 * the Control Plane Market registry; it binds Medusa's built-in payment,
 * fulfilment, and tax providers explicitly. External provider packages and
 * credentials remain a later, separately approved concern.
 */
export async function bootstrapMarket(
  container: ExecArgs["container"],
  config: MarketBootstrapConfig,
): Promise<void> {
  const regionService = container.resolve<IRegionModuleService>(Modules.REGION)
  const salesChannelService = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const stockLocationService = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const storeService = container.resolve<IStoreModuleService>(Modules.STORE)
  const fulfillmentService = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
  const taxService = container.resolve<ITaxModuleService>(Modules.TAX)
  const pricingService = container.resolve<IPricingModuleService>(Modules.PRICING)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as {
    create(links: Record<string, Record<string, string>>[]): Promise<unknown>
  }

  const log = (message: string, meta: Record<string, unknown> = {}) =>
    logger.info(message, { marketKey: config.marketKey, ...meta })

  // Store currency support.
  const [store] = await storeService.listStores({}, { relations: ["supported_currencies"] })
  if (store) {
    const currencyCode = toMedusaCurrencyCode(config.defaultCurrency)
    const alreadySupported = (store.supported_currencies ?? []).some(
      (currency) => currency.currency_code === currencyCode,
    )
    if (!alreadySupported) {
      await storeService.updateStores(store.id, {
        supported_currencies: withAddedStoreCurrency(
          store.supported_currencies ?? [],
          currencyCode,
        ),
      })
      log("added market currency to store", { currencyCode })
    }
  } else {
    log("no store found; skipping store currency binding", { level: "warn" })
  }

  // Region. Medusa enforces at most one Region per country store-wide, so a
  // country already covered by another Digital Estate's Region (e.g.
  // ZuriBeans B2B provisioning Uganda before Thamani B2C does) is reused
  // as-is rather than recreated — see findByCountryCode.
  //
  // Region creation goes through `createRegionsWorkflow` (the same workflow
  // the Admin API's Create Region route runs), NOT `regionService.createRegions`
  // directly: the plain Region module service silently drops `payment_providers`
  // — it's declared on the shared DTO type but the module itself has no way to
  // create a cross-module link, so the resulting `region_payment_provider` row
  // (what `validateCartPaymentsStep`/checkout actually reads) never gets
  // created. Calling the module service here previously meant no Digital
  // Estate's Region ever had a real payment provider binding, so no cart in
  // any Market could ever pass checkout's payment validation.
  const existingRegions = await regionService.listRegions({}, { relations: ["countries"] })
  let region = findByCountryCode(existingRegions, config.countryCode)
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: config.displayName,
            currency_code: toMedusaCurrencyCode(config.defaultCurrency),
            countries: [config.countryCode.toLowerCase()],
            automatic_taxes: config.tax.automaticTaxes,
            payment_providers: [...config.payment.providerIds],
            metadata: regionMappingTag(config.marketKey),
          },
        ],
      },
    })
    region = result[0]
    log("created region with payment provider binding", { regionId: region.id })
  } else {
    if (region.currency_code !== toMedusaCurrencyCode(config.defaultCurrency)) {
      throw new Error(
        `Region for country ${config.countryCode} already exists with currency ` +
          `${region.currency_code}, not ${toMedusaCurrencyCode(config.defaultCurrency)}`,
      )
    }
    log("region already provisioned for this country by another Digital Estate", {
      regionId: region.id,
    })
  }

  // Reconcile the region's payment provider bindings on every run, not just
  // at creation: a Region reused from a sibling estate (above) never went
  // through this Market's own `createRegionsWorkflow` call, and a Region
  // that already exists from before this fix was ever applied has no
  // `region_payment_provider` rows at all. Only ever add this Market's
  // configured providers to whatever is already linked — never replace the
  // full set — so a sibling estate's own provider choice for this shared
  // Region is never dropped (`setRegionsPaymentProvidersStep`, which both
  // workflows below run through, treats its input as the complete desired
  // set and removes anything not in it).
  const query = container.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.QUERY)
  const { data: regionPaymentProviderData } = await query.graph({
    entity: "region",
    fields: ["payment_providers.id"],
    filters: { id: region.id },
  })
  const linkedProviderIds = new Set(
    (
      (regionPaymentProviderData[0] as { payment_providers?: { id: string }[] } | undefined)
        ?.payment_providers ?? []
    ).map((provider) => provider.id),
  )
  const missingProviderIds = config.payment.providerIds.filter(
    (providerId) => !linkedProviderIds.has(providerId),
  )
  if (missingProviderIds.length > 0) {
    await updateRegionsWorkflow(container).run({
      input: {
        selector: { id: region.id },
        update: { payment_providers: [...linkedProviderIds, ...missingProviderIds] },
      },
    })
    log("bound missing payment providers to region", { providerIds: missingProviderIds })
  }

  // Sales channel.
  const existingSalesChannels = await salesChannelService.listSalesChannels({})
  let salesChannel = findByMetadataKey(
    existingSalesChannels,
    "baobab_sales_channel_key",
    config.salesChannel.key,
  )
  if (!salesChannel) {
    salesChannel = await salesChannelService.createSalesChannels({
      name: config.salesChannel.name,
    })
    salesChannel = await salesChannelService.updateSalesChannels(salesChannel.id, {
      metadata: salesChannelProjectionTag(config.salesChannel.key),
    })
    log("created sales channel", { salesChannelId: salesChannel.id })
  } else {
    log("sales channel already provisioned", { salesChannelId: salesChannel.id })
  }

  // Stock location.
  const existingStockLocations = await stockLocationService.listStockLocations({})
  let stockLocation = findByMarketKey(existingStockLocations, config.marketKey)
  if (!stockLocation) {
    stockLocation = await stockLocationService.createStockLocations({
      name: config.stockLocation.name,
      address: {
        address_1: config.stockLocation.addressLine,
        country_code: config.countryCode.toLowerCase(),
        city: config.stockLocation.city,
      },
      metadata: stockLocationMappingTag(config.marketKey),
    })
    log("created stock location", { stockLocationId: stockLocation.id })
  } else {
    log("stock location already provisioned", { stockLocationId: stockLocation.id })
  }

  // Tax Region. Rates are deliberately not seeded: Control Plane tax policy
  // and later jurisdiction gates remain authoritative for rates and tariffs.
  const [taxRegion] = await taxService.listTaxRegions({
    country_code: config.countryCode.toLowerCase(),
  })
  if (!taxRegion) {
    const created = await taxService.createTaxRegions({
      country_code: config.countryCode.toLowerCase(),
      provider_id: config.tax.providerId,
      metadata: {
        baobab_market_key: config.marketKey,
        baobab_tax_policy_reference: config.tax.policyReference,
      },
    })
    log("created tax region without hardcoded rates", { taxRegionId: created.id })
  } else if (taxRegion.provider_id !== config.tax.providerId) {
    // Medusa enforces at most one Tax Region per country store-wide (like
    // Region above), so a country another Digital Estate provisioned first
    // is reused rather than recreated — but `provider_id` is a single value
    // on that shared row, and this config's own declared provider was
    // previously silently ignored whenever the Region already existed. Keep
    // it in sync so a Market's own provider choice actually takes effect,
    // not just at first-ever creation.
    //
    // Never downgrade an already-installed non-default provider back to the
    // bundled `tp_system` default: a re-run of a sibling estate's bootstrap
    // (a legitimate, idempotent, order-independent operation — e.g. adding
    // a new ZuriBeans Market later) would otherwise silently strip whatever
    // custom provider another estate installed on this shared row, with no
    // later bootstrap guaranteed to reinstall it. Installing a non-default
    // provider over `tp_system` (in either direction, in any order) is
    // always safe to apply immediately.
    if (config.tax.providerId === "tp_system" && taxRegion.provider_id !== "tp_system") {
      log("keeping a sibling estate's non-default tax provider on this shared Tax Region", {
        taxRegionId: taxRegion.id,
        keptProviderId: taxRegion.provider_id,
      })
    } else {
      await taxService.updateTaxRegions({ id: taxRegion.id, provider_id: config.tax.providerId })
      log("updated tax region provider to match this Market's configuration", {
        taxRegionId: taxRegion.id,
        providerId: config.tax.providerId,
      })
    }
  } else {
    log("tax region already provisioned", { taxRegionId: taxRegion.id })
  }

  // Tax-inclusive pricing: only set when a Market actually declares it.
  // Medusa's own `isTaxInclusive` resolution (pricing-module.js) only honours
  // a `region_id`-scoped PricePreference when the price itself *also* carries
  // a matching `region_id` price rule — neither Thamani's nor ZuriBeans'
  // catalogue prices do (they're plain per-currency prices), so a
  // Region-scoped preference would silently never apply. `currency_code` is
  // the one scope that actually takes effect for prices shaped this way.
  // Without this, a real (non-zero) tax rate silently inflates every total
  // beyond the advertised, tax-inclusive sticker price.
  //
  // `allowedCurrencies` is shared with any sibling estate using the same
  // currency, like `provider_id` above — but that estate's own tax stays
  // unseeded (0%) today, so this is a real behaviour change for Thamani and
  // a no-op for it numerically. It is still only ever set to `true`: a
  // Market declaring `false` (net pricing) leaves Medusa's tax-exclusive
  // default untouched rather than writing a row that could fight a sibling
  // estate over the same shared currency.
  if (config.tax.pricesIncludeTax) {
    for (const currency of config.allowedCurrencies) {
      const currencyCode = toMedusaCurrencyCode(currency)
      // `price_preference` has a unique index on (attribute, value) and
      // `upsertPricePreferences` treats an id-less input as a create, not an
      // upsert against that constraint — a second run without this check
      // fails outright with a unique-constraint violation instead of being
      // a no-op.
      const [existingPreference] = await pricingService.listPricePreferences({
        attribute: "currency_code",
        value: currencyCode,
      })
      if (!existingPreference) {
        await pricingService.createPricePreferences({
          attribute: "currency_code",
          value: currencyCode,
          is_tax_inclusive: true,
        })
        log("set currency prices to tax-inclusive", { currencyCode })
      } else if (!existingPreference.is_tax_inclusive) {
        await pricingService.updatePricePreferences(existingPreference.id, {
          is_tax_inclusive: true,
        })
        log("updated currency price preference to tax-inclusive", { currencyCode })
      }
    }
  }

  // Shipping context: a location-bound fulfillment set and a country service
  // zone.
  let [fulfillmentSet] = await fulfillmentService.listFulfillmentSets({
    name: config.shipping.fulfillmentSet.name,
  })
  if (!fulfillmentSet) {
    fulfillmentSet = await fulfillmentService.createFulfillmentSets({
      name: config.shipping.fulfillmentSet.name,
      type: config.shipping.fulfillmentSet.type,
      service_zones: [
        {
          name: config.shipping.serviceZone.name,
          geo_zones: [
            {
              type: "country",
              country_code: config.shipping.serviceZone.countryCode.toLowerCase(),
            },
          ],
        },
      ],
    })
    await remoteLink.create([
      {
        [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
        [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
      },
    ])
    log("created location shipping context", { fulfillmentSetId: fulfillmentSet.id })
  } else {
    log("shipping context already provisioned", { fulfillmentSetId: fulfillmentSet.id })
  }

  // Reconciled on every run, not just at stock-location creation:
  // `remoteLink.create` is safe to call again for a link that already
  // exists (confirmed against a live database — it's the same call
  // Medusa's own "Manage Sales Channels" Admin API route makes on every
  // save, whether or not the selection actually changed), so this never
  // needs a "did I already do this" guard. Gating it on `stockLocationCreated`
  // previously meant a bootstrap run that failed after creating the stock
  // location but before reaching this point would have its retry find the
  // stock location already there, permanently skip re-linking, and then
  // fail below with "Providers (...) are not enabled for the service
  // location" — with no way to self-heal short of a manual fix.
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [salesChannel.id], remove: [] },
  })
  await remoteLink.create(
    config.shipping.providerIds.map((providerId) => ({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: providerId },
    })),
  )
  log("bound stock location to Sales Channel and fulfillment providers")

  // Shipping option: `completeCartWorkflow` cannot succeed without a real,
  // priced option on the service zone above — see the doc comment on
  // `MarketBootstrapConfig.shipping.shippingOption` for why this can't be a
  // sourced rate yet. Idempotency checks for THIS Market's configured option
  // specifically (by name, scoped to the service zone) rather than "does the
  // zone already have any option at all": a zone that already carries a
  // different option — a different shipping profile, or priced only in a
  // different currency — would otherwise look "already provisioned" while
  // still leaving this Market's own checkout unable to find a usable rate.
  // Must run after the stock-location-to-fulfillment-provider binding above:
  // Medusa's own `createShippingOptionsWorkflow` validates the option's
  // provider is already enabled for the option's service location, so
  // creating it any earlier fails with "Providers (...) are not enabled for
  // the service location".
  const [serviceZone] = await fulfillmentService.listServiceZones({
    name: config.shipping.serviceZone.name,
  })
  if (!serviceZone)
    throw new Error(`Service zone "${config.shipping.serviceZone.name}" was not provisioned`)
  const [existingShippingOption] = await fulfillmentService.listShippingOptions({
    name: config.shipping.shippingOption.name,
    service_zone: { id: serviceZone.id },
  })
  if (!existingShippingOption) {
    // Medusa seeds one "default"-type Shipping Profile at migration time,
    // shared across every Digital Estate — the same one the catalogue
    // bootstrap scripts look up. Fall back to creating it only if that
    // seeding ever doesn't happen (e.g. a future Medusa version, or a
    // database this fix runs against before that seeding occurred).
    let [shippingProfile] = await fulfillmentService.listShippingProfiles({ type: "default" })
    if (!shippingProfile) {
      shippingProfile = await fulfillmentService.createShippingProfiles({
        name: "Default Shipping Profile",
        type: "default",
      })
    }
    const currencyCode = toMedusaCurrencyCode(config.defaultCurrency)
    const { result: createdShippingOptions } = await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: config.shipping.shippingOption.name,
          service_zone_id: serviceZone.id,
          shipping_profile_id: shippingProfile.id,
          provider_id: config.shipping.providerIds[0],
          type: {
            label: "Standard",
            description: "Standard shipping",
            code: "standard",
          },
          price_type: "flat",
          prices: [{ amount: config.shipping.shippingOption.amount, currency_code: currencyCode }],
        },
      ],
    })
    log("created shipping option", { shippingOptionId: createdShippingOptions[0].id })
  } else {
    log("shipping option already provisioned", { shippingOptionId: existingShippingOption.id })
  }

  log("market provider bindings configured", {
    payment: config.payment,
    shipping: config.shipping,
    tax: config.tax,
  })
}
