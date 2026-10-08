import type { ExecArgs } from "@medusajs/framework/types"
import {
  THAMANI_LAUNCH_MARKETS,
  getThamaniMarketBootstrapConfig,
} from "../baobab/market/thamani-market-config"
import { bootstrapMarket } from "../baobab/market/provisioning"

/**
 * Idempotently provisions the Medusa-side commerce projection for the
 * Thamani B2C launch Markets (Uganda, South Africa). Run
 * `bootstrap-market.ts` first if ZuriBeans has not been provisioned yet —
 * the two are independent, but both bootstrap the same Store and Postgres
 * schema, so ordering only matters for readable logs, not correctness.
 */
export default async function ({ container, args }: ExecArgs) {
  const requestedKey = args[0]
  const targets = requestedKey
    ? [getThamaniMarketBootstrapConfig(requestedKey)]
    : THAMANI_LAUNCH_MARKETS

  for (const config of targets) {
    await bootstrapMarket(container, config)
  }
}
