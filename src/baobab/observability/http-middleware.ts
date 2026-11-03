import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { enterHttpTrace } from "./tracing"

/** Actual Medusa HTTP middleware, not a duplicated test HTTP server.
 * All auth/tenant/CP checks run unchanged in the downstream handler.
 */
export function tradeTraceMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): void {
  const incoming = req.headers.traceparent
  const trustedShape = typeof incoming === "string" ? incoming : undefined
  enterHttpTrace(trustedShape, (span) => {
    res.setHeader("traceparent", span.traceparent)
    let completed = false
    const completion = () => {
      if (completed) return
      completed = true
      span.finish(res.statusCode)
      console.info("trade HTTP completed", {
        route: "TRADE_ENGINE",
        method: req.method,
        status: res.statusCode,
        trace_id: span.traceId,
        span_id: span.spanId,
        parent_span_id: span.parentSpanId,
      })
    }
    res.once("finish", completion)
    res.once("close", completion)
    next()
  })
}
