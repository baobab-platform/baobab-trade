import type { BaobabTenantContext } from "../contracts/tenant-context"

/**
 * Mirrors baobab-platform/shared contracts/events/v1/envelope.schema.json — a
 * CloudEvents 1.0 structured JSON profile. `baobabscope` and `tenantid` are
 * modelled as a discriminated union so a platform event can never carry (or
 * omit) tenant context incorrectly at compile time, matching the schema's
 * if/then/else coupling rule.
 */
type BaobabCloudEventBase<TData extends Record<string, unknown>> = {
  specversion: "1.0"
  id: string
  type: string
  source: string
  subject: string
  time: string
  datacontenttype: "application/json"
  dataschema: string
  correlationid: string
  causationid?: string
  idempotencykey?: string
  traceparent?: string
  tracestate?: string
  data: TData
}

export type BaobabTenantEvent<TData extends Record<string, unknown> = Record<string, unknown>> =
  BaobabCloudEventBase<TData> & { baobabscope: "tenant"; tenantid: string }

export type BaobabPlatformEvent<TData extends Record<string, unknown> = Record<string, unknown>> =
  BaobabCloudEventBase<TData> & { baobabscope: "platform" }

export type BaobabCloudEvent<TData extends Record<string, unknown> = Record<string, unknown>> =
  | BaobabTenantEvent<TData>
  | BaobabPlatformEvent<TData>

/**
 * Stable logical producer URI (ADR-SHARED-018 §3.7). Must never be a
 * deployment hostname (envelope `source` rule).
 */
export const TRADE_EVENT_SOURCE = "urn:baobab-platform:service:baobab-trade"

/**
 * Event-source URIs Trade has published under, current first. Consumers of
 * Trade events accept every entry during the migration window
 * (ADR-SHARED-018 §3.7, consumers first); producers use only the first.
 */
export const TRADE_EVENT_SOURCES = [TRADE_EVENT_SOURCE, "urn:baobab-platform:baobab-trade"] as const

/** Canonical event-type syntax (ADR-SHARED-008 §3, envelope `type` pattern). */
const EVENT_TYPE_PATTERN = /^com\.baobab-platform\.[a-z0-9]+(?:[.-][a-z0-9]+)*\.v[1-9][0-9]*$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const assertValidEventType = (type: string): void => {
  if (!EVENT_TYPE_PATTERN.test(type)) {
    throw new Error(`Event type "${type}" does not match com.baobab-platform.<context>.<...>.v<N>`)
  }
}

export type TradeEventInput<TData extends Record<string, unknown>> = {
  id: string
  type: string
  subject: string
  time: string
  dataschema: string
  correlationid: string
  causationid?: string
  idempotencykey?: string
  traceparent?: string
  tracestate?: string
  data: TData
}

export const createTenantTradeEvent = <TData extends Record<string, unknown>>(
  context: BaobabTenantContext,
  input: TradeEventInput<TData>,
): BaobabTenantEvent<TData> => {
  assertValidEventType(input.type)
  return {
    specversion: "1.0",
    datacontenttype: "application/json",
    source: TRADE_EVENT_SOURCE,
    baobabscope: "tenant",
    tenantid: context.tenantId,
    ...input,
  }
}

export const createPlatformTradeEvent = <TData extends Record<string, unknown>>(
  input: TradeEventInput<TData>,
): BaobabPlatformEvent<TData> => {
  assertValidEventType(input.type)
  return {
    specversion: "1.0",
    datacontenttype: "application/json",
    source: TRADE_EVENT_SOURCE,
    baobabscope: "platform",
    ...input,
  }
}

export const isValidCloudEvent = (candidate: unknown): candidate is BaobabCloudEvent => {
  if (typeof candidate !== "object" || candidate === null) return false
  const value = candidate as Partial<BaobabCloudEvent> & Record<string, unknown>

  const baseValid =
    value.specversion === "1.0" &&
    typeof value.id === "string" &&
    UUID_PATTERN.test(value.id) &&
    typeof value.type === "string" &&
    EVENT_TYPE_PATTERN.test(value.type) &&
    typeof value.source === "string" &&
    typeof value.subject === "string" &&
    value.subject.length > 0 &&
    typeof value.time === "string" &&
    value.datacontenttype === "application/json" &&
    typeof value.dataschema === "string" &&
    typeof value.correlationid === "string" &&
    UUID_PATTERN.test(value.correlationid) &&
    typeof value.data === "object" &&
    value.data !== null

  if (!baseValid) return false

  if (value.baobabscope === "tenant") {
    return typeof value.tenantid === "string" && value.tenantid.length > 0
  }

  return value.baobabscope === "platform" && value.tenantid === undefined
}

/**
 * Legacy com.nabhold.* event families are retired (ADR-SHARED-018 §9). Trade
 * emitted none of them except the Thamani ERP projection commands, which are
 * retired outright (§8.5). When Trade starts publishing one of the facts the
 * old families described, it uses the canonical type §9 assigns (for example
 * commerce.order-payment.initiated.v1 or fulfilment.fulfilment-order.dispatched.v1),
 * registered in Shared contracts/events/v1/event-registry.yaml first.
 */
