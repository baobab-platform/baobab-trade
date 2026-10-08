import { Modules } from "@medusajs/framework/utils"
import type {
  ExecArgs,
  IFulfillmentModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
  IStoreModuleService,
  ITaxModuleService,
} from "@medusajs/framework/types"
import { ZURIBEANS_LAUNCH_MARKETS, toMedusaCurrencyCode } from "../baobab/market/market-config"
import { findByCountryCode, findByMarketKey, findByMetadataKey } from "../baobab/market/mapping"

const required = <T>(value: T | undefined, message: string): T => {
  if (!value) throw new Error(message)
  return value
}

export default async function ({ container }: ExecArgs) {
  const regions = await container
    .resolve<IRegionModuleService>(Modules.REGION)
    .listRegions({}, { relations: ["countries"] })
  const channels = await container
    .resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
    .listSalesChannels({})
  const locations = await container
    .resolve<IStockLocationService>(Modules.STOCK_LOCATION)
    .listStockLocations({})
  const taxService = container.resolve<ITaxModuleService>(Modules.TAX)
  const fulfillmentService = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
  const [store] = await container
    .resolve<IStoreModuleService>(Modules.STORE)
    .listStores({}, { relations: ["supported_currencies"] })

  required(
    findByMetadataKey(channels, "baobab_sales_channel_key", "zuribeans_b2b"),
    "Principal ZuriBeans B2B Sales Channel is missing",
  )

  for (const config of ZURIBEANS_LAUNCH_MARKETS) {
    // Region is looked up by country, not by the `zuribeans_*` market-key
    // tag: Medusa allows only one Region per country, so this Market's
    // Region may legitimately have been provisioned first by Thamani B2C
    // and carry its `thamani_*` tag instead. See findByCountryCode.
    const region = required(
      findByCountryCode(regions, config.countryCode),
      `Region projection is missing for ${config.marketKey}`,
    )
    if (region.currency_code !== toMedusaCurrencyCode(config.defaultCurrency)) {
      throw new Error(`Region currency mismatch for ${config.marketKey}`)
    }
    required(
      findByMarketKey(locations, config.marketKey),
      `Stock Location projection is missing for ${config.marketKey}`,
    )
    required(
      store?.supported_currencies?.find(
        (currency) => currency.currency_code === toMedusaCurrencyCode(config.defaultCurrency),
      ),
      `Store currency support is missing for ${config.defaultCurrency}`,
    )
    const [taxRegion] = await taxService.listTaxRegions({
      country_code: config.countryCode.toLowerCase(),
    })
    required(taxRegion, `Tax Region is missing for ${config.countryCode}`)
    const [fulfillmentSet] = await fulfillmentService.listFulfillmentSets({
      name: config.shipping.fulfillmentSet.name,
    })
    required(fulfillmentSet, `Shipping context is missing for ${config.marketKey}`)
  }
}
