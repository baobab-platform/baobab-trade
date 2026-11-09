import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getBaobabTradeEnvironment } from "../../baobab/config/environment"
import {
  checkTradeReadiness,
  type TradeDatabaseProbe,
} from "../../baobab/health/readiness"

/**
 * ADR-0007 §47: this is a traffic-admission probe, not a liveness probe.
 * The PostgreSQL connection must actually answer a query. An available
 * Medusa HTTP process is not evidence that the commerce store is usable.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  let controlPlaneConfigured = false
  try {
    const environment = getBaobabTradeEnvironment()
    controlPlaneConfigured = Boolean(
      environment.controlPlaneBaseUrl && environment.controlPlaneContextPath,
    )
  } catch {
    // Missing required configuration is not readiness; don't leak its value.
  }

  let database: TradeDatabaseProbe | undefined
  try {
    database = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as TradeDatabaseProbe
  } catch {
    // Unregistered connections also fail closed.
  }

  const report = await checkTradeReadiness({ database, controlPlaneConfigured })
  res.setHeader("cache-control", "no-store")
  res.status(report.status === "ready" ? 200 : 503).json(report)
}
