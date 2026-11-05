import {
  context as otelContext,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api"
import { AsyncLocalStorage } from "node:async_hooks"
import { randomBytes } from "node:crypto"

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/i

export type TraceContext = {
  traceId: string
  parentSpanId: string
  sampled: boolean
  traceparent: string
  correlationId: string
}

export const parseTraceContext = (traceparent: string, correlationId: string): TraceContext => {
  const match = TRACEPARENT.exec(traceparent)
  if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2]))
    throw new Error("INVALID_TRACEPARENT")
  return {
    traceId: match[1].toLowerCase(),
    parentSpanId: match[2].toLowerCase(),
    sampled: match[3] === "01",
    traceparent,
    correlationId,
  }
}

export const traceHeaders = (context: TraceContext) => ({
  traceparent: context.traceparent,
  "x-correlation-id": context.correlationId,
})

/** W3C context is diagnostic only, never IAM/CP authority or a metric label. */
type RuntimeSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  flags: string
}

const runtimeTrace = new AsyncLocalStorage<RuntimeSpan>()
const nativeTracer = trace.getTracer("baobab.trade.native", "dev11")
const fresh = (bytes: number) => randomBytes(bytes).toString("hex")
const format = (context: RuntimeSpan): string =>
  `00-${context.traceId}-${context.spanId}-${context.flags}`

const nativeOperation = (operation: "HTTP" | "EVENT_PUBLISH" | "EVENT_CONSUME"): string => {
  switch (operation) {
    case "HTTP":
      return "baobab.trade.http"
    case "EVENT_PUBLISH":
      return "baobab.trade.event.publish"
    case "EVENT_CONSUME":
      return "baobab.trade.event.consume"
  }
}

/** Caller trace headers are not authorization and may be malformed. */
const nativeContext = (parent: TraceContext | undefined) =>
  parent ? propagation.extract(ROOT_CONTEXT, { traceparent: parent.traceparent }) : ROOT_CONTEXT

const effectiveSpan = (
  native: { spanContext(): { traceId: string; spanId: string; traceFlags: number } },
  parent: TraceContext | undefined,
): RuntimeSpan => {
  const observed = native.spanContext()
  const valid = observed.traceId !== "00000000000000000000000000000000"
  return valid
    ? {
        traceId: observed.traceId,
        spanId: observed.spanId,
        parentSpanId: parent?.parentSpanId,
        flags: observed.traceFlags & 1 ? "01" : "00",
      }
    : {
        traceId: parent?.traceId ?? fresh(16),
        spanId: fresh(8),
        parentSpanId: parent?.parentSpanId,
        flags: parent?.sampled === false ? "00" : "01",
      }
}

export const currentTraceparent = (): string | undefined => {
  const span = runtimeTrace.getStore()
  return span === undefined ? undefined : format(span)
}

/** Never invent an unexported per-call child span ID. The downstream native
 * server creates and exports its own span with this real recorded parent. */
export const outboundTraceparent = (): string | undefined => currentTraceparent()

export async function withIncomingTradeTrace<T>(
  incoming: string | undefined,
  operation: "HTTP" | "EVENT_PUBLISH" | "EVENT_CONSUME",
  action: () => Promise<T>,
): Promise<T> {
  let parent: TraceContext | undefined
  if (incoming) {
    try {
      parent = parseTraceContext(incoming, "")
    } catch {
      // Malformed trace creates a diagnostic root without changing authority.
    }
  }
  const extracted = nativeContext(parent)
  const kind =
    operation === "EVENT_CONSUME"
      ? SpanKind.CONSUMER
      : operation === "EVENT_PUBLISH"
        ? SpanKind.PRODUCER
        : SpanKind.SERVER
  const otel = nativeTracer.startSpan(nativeOperation(operation), { kind }, extracted)
  const span = effectiveSpan(otel, parent)
  return otelContext.with(trace.setSpan(extracted, otel), () =>
    runtimeTrace.run(span, async () => {
      try {
        return await action()
      } catch (error) {
        // Exception messages/stacks may contain PII. Export only fixed status.
        otel.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        console.info("trade native span completed", {
          operation,
          trace_id: span.traceId,
          span_id: span.spanId,
          parent_span_id: span.parentSpanId ?? "",
        })
        otel.end()
      }
    }),
  )
}

/** Signed canonical event identity stays unchanged under redelivery. */
export async function withEventDeliveryTrace<T>(
  event: { traceparent?: string },
  operation: "EVENT_PUBLISH" | "EVENT_CONSUME",
  action: () => Promise<T>,
): Promise<T> {
  return withIncomingTradeTrace(event.traceparent, operation, action)
}

/** Actual Medusa HTTP middleware owns the response lifecycle. */
export function enterHttpTrace(
  incoming: string | undefined,
  action: (server: {
    traceparent: string
    traceId: string
    spanId: string
    parentSpanId: string
    finish: (status: number) => void
  }) => void,
): void {
  let parent: TraceContext | undefined
  if (incoming) {
    try {
      parent = parseTraceContext(incoming, "")
    } catch {
      // An invalid header does not grant or borrow another subject's trace.
    }
  }
  const extracted = nativeContext(parent)
  const otel = nativeTracer.startSpan(nativeOperation("HTTP"), { kind: SpanKind.SERVER }, extracted)
  const span = effectiveSpan(otel, parent)
  let ended = false
  const finish = (status: number) => {
    if (ended) return
    ended = true
    otel.setAttribute("http.response.status_code", status)
    if (status >= 500) otel.setStatus({ code: SpanStatusCode.ERROR })
    otel.end()
  }
  try {
    otelContext.with(trace.setSpan(extracted, otel), () =>
      runtimeTrace.run(span, () =>
        action({
          traceparent: format(span),
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId ?? "",
          finish,
        }),
      ),
    )
  } catch (error) {
    finish(500)
    throw error
  }
}

/** Native diagnostic transport context, absent when no recorded span exists. */
export const outgoingTraceHeaders = (): { traceparent?: string } => {
  const span = outboundTraceparent()
  return span ? { traceparent: span } : {}
}
