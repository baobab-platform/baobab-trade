import type { ExecArgs } from "@medusajs/framework/types"
import { verifyInfrastructureModules } from "../baobab/health/infrastructure"
import { createStructuredLogger } from "../baobab/logging/logger"

const logger = createStructuredLogger("verify-infrastructure")

export default async function ({ container }: ExecArgs) {
  const results = verifyInfrastructureModules(container)
  for (const result of results) logger.info("infrastructure module probe passed", result)
  logger.info("all production infrastructure module probes passed", {
    moduleCount: results.length,
  })
}
