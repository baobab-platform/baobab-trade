/**
 * ADR-0007 §47 / INV-COM-002: readiness is a live, bounded database probe.
 *
 * Configuration alone is not evidence that PostgreSQL is accepting commerce
 * traffic. Keep this check separate from liveness and never expose DB errors,
 * credentials, connection strings, or SQL diagnostics to unauthenticated clients.
 */
export interface TradeDatabaseProbe {
  raw(sql: string): {
    timeout(ms: number, options: { cancel: true }): PromiseLike<unknown>
  }
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
      // Bound the HTTP response even if pool acquisition is waiting. Knex's
      // query timeout also cancels an executing PostgreSQL statement instead
      // of leaving a timed-out readiness query occupying a pooled connection.
      const query = database.raw("SELECT 1").timeout(timeoutMs, { cancel: true })
      await Promise.race([
        query,
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
