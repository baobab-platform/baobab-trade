/**
 * Reads the live native attributes a seller configuration digests
 * (ADR-SHARED-039 Trade-0): sales-channel state and region currency and
 * countries, from Medusa's own modules. Never from a request.
 */
import type {
  IRegionModuleService,
  ISalesChannelModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { NativeSellerFactsReader } from "./native-seller-configuration"

export function medusaNativeSellerFacts(container: MedusaContainer): NativeSellerFactsReader {
  const channels = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const regions = container.resolve<IRegionModuleService>(Modules.REGION)
  return {
    async read(salesChannelIds, regionIds) {
      const [salesChannels, regionRows] = await Promise.all([
        channels.listSalesChannels({ id: [...salesChannelIds] }),
        regions.listRegions({ id: [...regionIds] }, { relations: ["countries"] }),
      ])
      return {
        salesChannels: salesChannels.map((c) => ({ id: c.id, is_disabled: c.is_disabled })),
        regions: regionRows.map((r) => ({
          id: r.id,
          currency_code: r.currency_code,
          countries: (r.countries ?? []).map((c) => c.iso_2),
        })),
      }
    },
  }
}
