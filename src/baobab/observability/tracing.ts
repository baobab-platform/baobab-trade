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
