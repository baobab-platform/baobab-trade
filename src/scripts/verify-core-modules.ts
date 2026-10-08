import type { ExecArgs } from "@medusajs/framework/types"
import { verifyCoreModules } from "../baobab/health/core-modules"
import { createStructuredLogger } from "../baobab/logging/logger"

const logger = createStructuredLogger("verify-core-modules")

export default async function ({ container }: ExecArgs) {
  const results = await verifyCoreModules(container)

  for (const result of results) {
    logger.info("core module read probe passed", result)
  }

  logger.info("all required Medusa core module probes passed", {
    moduleCount: results.length,
  })
}
