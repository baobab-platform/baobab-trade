import type { ExecArgs } from "@medusajs/framework/types"
import { ZURIBEANS_LAUNCH_MARKETS, getMarketBootstrapConfig } from "../baobab/market/market-config"
import { bootstrapMarket } from "../baobab/market/provisioning"

/**
 * Idempotently provisions the Medusa-side commerce projection for the
 * ZuriBeans B2B launch Markets. See `src/baobab/market/provisioning.ts` for
 * the shared, estate-agnostic mechanics (also used by
 * `bootstrap-thamani-market.ts`).
 */
export default async function ({ container, args }: ExecArgs) {
  const requestedKey = args[0]
  const targets = requestedKey ? [getMarketBootstrapConfig(requestedKey)] : ZURIBEANS_LAUNCH_MARKETS

  for (const config of targets) {
    await bootstrapMarket(container, config)
  }
}
