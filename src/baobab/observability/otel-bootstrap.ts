/** Official OpenTelemetry OTLP exporter for Medusa native DEV-11 runtime.
 *
 * Disabled unless an explicit OTLP endpoint is configured. Telemetry
 * failures cannot grant/deny authority or rewrite canonical event identity.
 */
import { NodeSDK } from "@opentelemetry/sdk-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"

let sdk: NodeSDK | undefined

export function startTradeOTel(): void {
  if (sdk !== undefined) return
  const configured = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  if (!configured) return

  const target = new URL(configured)
  const environment = process.env.BAOBAB_ENVIRONMENT || process.env.NODE_ENV || "development"
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== "/v1/traces" ||
    (!["development", "test", "integration"].includes(environment) && target.protocol !== "https:")
  ) {
    throw new Error("DEV11_OTLP_ENDPOINT_NOT_APPROVED")
  }

  const resource = resourceFromAttributes({
    "service.name": "baobab-trade",
    "service.namespace": "baobab",
    "service.version": process.env.BAOBAB_SERVICE_VERSION || "development",
    "deployment.environment.name": environment,
  })
  sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({ url: target.toString(), timeoutMillis: 6000 }),
  })
  sdk.start()
}

export const tradeOTelConfigured = (): boolean => sdk !== undefined

export const shutdownTradeOTel = async (): Promise<void> => {
  await sdk?.shutdown()
  sdk = undefined
}
