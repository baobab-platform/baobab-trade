/**
 * ADR-0007 §47 / INV-COM-002: readiness is a live, bounded database probe.
 *
 * Configuration alone is not evidence that PostgreSQL is accepting commerce
 * traffic. Keep this check separate from liveness and never expose DB errors,
 * credentials, connection strings, or SQL diagnostics to unauthenticated clients.
 */
export interface TradeDatabaseProbe {
  raw(sql: string): PromiseLike<unknown>
}

export type TradeReadinessReport = {
  status: "ready" | "not_ready"
  dependencies: {
    medusa: "configured"
    postgres: "up" | "down"
    control_plane: "configured" | "not_configured"
  }
}

export const DEFAULT_READINESS_TIMEOUT_MS = 1500

export async function checkTradeReadiness(options: {
  database?: TradeDatabaseProbe
  controlPlaneConfigured: boolean
  timeoutMs?: number
}): Promise<TradeReadinessReport> {
  const dependencies: TradeReadinessReport["dependencies"] = {
    medusa: "configured",
    postgres: "down",
    control_plane: options.controlPlaneConfigured ? "configured" : "not_configured",
  }

  // Do not start a query when the Medusa connection is not registered.
  const database = options.database
  if (database && typeof database.raw === "function") {
    const timeoutMs =
      options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_READINESS_TIMEOUT_MS

    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // A bound on the *entire* probe includes waiting for a connection
      // from the pool, not merely PostgreSQL's query execution time.
      await Promise.race([
        Promise.resolve().then(() => database.raw("SELECT 1")),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("readiness deadline exceeded")), timeoutMs)
        }),
      ])
      dependencies.postgres = "up"
    } catch {
      // A failed or timed-out probe is DOWN regardless of error details.
      // Errors must not be serialized into the readiness response.
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  return {
    status:
      dependencies.postgres === "up" && dependencies.control_plane === "configured"
        ? "ready"
        : "not_ready",
    dependencies,
  }
}
