import { Modules } from "@medusajs/framework/utils"

type ResolvableContainer = {
  resolve(name: string): unknown
}

type ModuleProbe = {
  capability: string
  registration: string
  readMethod: string
}

export type CoreModuleProbeResult = {
  capability: string
  registration: string
  readMethod: string
  resolved: true
  readable: true
}

export const REQUIRED_CORE_MODULE_PROBES: readonly ModuleProbe[] = [
  { capability: "Product", registration: Modules.PRODUCT, readMethod: "listProducts" },
  { capability: "Pricing", registration: Modules.PRICING, readMethod: "listPriceSets" },
  { capability: "Customer", registration: Modules.CUSTOMER, readMethod: "listCustomers" },
  { capability: "Cart", registration: Modules.CART, readMethod: "listCarts" },
  { capability: "Order", registration: Modules.ORDER, readMethod: "listOrders" },
  {
    capability: "Inventory",
    registration: Modules.INVENTORY,
    readMethod: "listInventoryItems",
  },
  {
    capability: "Stock Location",
    registration: Modules.STOCK_LOCATION,
    readMethod: "listStockLocations",
  },
  { capability: "Region", registration: Modules.REGION, readMethod: "listRegions" },
  {
    capability: "Sales Channel",
    registration: Modules.SALES_CHANNEL,
    readMethod: "listSalesChannels",
  },
  { capability: "Currency", registration: Modules.CURRENCY, readMethod: "listCurrencies" },
  {
    capability: "Payment",
    registration: Modules.PAYMENT,
    readMethod: "listPaymentCollections",
  },
  {
    capability: "Fulfillment",
    registration: Modules.FULFILLMENT,
    readMethod: "listFulfillments",
  },
  { capability: "Tax", registration: Modules.TAX, readMethod: "listTaxRegions" },
  { capability: "Auth", registration: Modules.AUTH, readMethod: "listAuthIdentities" },
  { capability: "API Key", registration: Modules.API_KEY, readMethod: "listApiKeys" },
  { capability: "Store", registration: Modules.STORE, readMethod: "listStores" },
] as const

type ReadableModule = Record<string, unknown>

export const verifyCoreModules = async (
  container: ResolvableContainer,
): Promise<CoreModuleProbeResult[]> => {
  const results: CoreModuleProbeResult[] = []

  for (const probe of REQUIRED_CORE_MODULE_PROBES) {
    const service = container.resolve(probe.registration) as ReadableModule
    const read = service?.[probe.readMethod]

    if (typeof read !== "function") {
      throw new Error(
        `${probe.capability} module '${probe.registration}' does not expose ${probe.readMethod}`,
      )
    }

    await read.call(service, {}, { take: 1 })
    results.push({ ...probe, resolved: true, readable: true })
  }

  return results
}
