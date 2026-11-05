/** DEV-11 disposable native Medusa/PostgreSQL source for real Rabbit qualification.
 *
 * This seeds a synthetic canonical outbox event, not an authorised commerce
 * order, and cannot by itself qualify an ERP financial consequence.
 */
import { randomUUID } from "node:crypto"
import type { ExecArgs, ILockingModule } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { TransactionalOutbox, createTenantTradeEvent } from "../baobab/events"
import { EventOutboxRecordAdapter } from "../baobab/events/outbox-record-adapter"
import { currentTraceparent, withIncomingTradeTrace } from "../baobab/observability/tracing"
import {
  shutdownTradeOTel,
  startTradeOTel,
  tradeOTelConfigured,
} from "../baobab/observability/otel-bootstrap"
import type EventOutboxModuleService from "../modules/event-outbox/service"

export default async function ({ container }: ExecArgs): Promise<void> {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.BAOBAB_ENVIRONMENT !== "development" ||
    process.env.BAOBAB_DEV11_RABBIT_CONNECTED_REQUIRED !== "true"
  ) {
    throw new Error("DEV11_RABBIT_DISPOSABLE_TEST_ONLY")
  }
  startTradeOTel()
  if (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT && !tradeOTelConfigured()) {
    throw new Error("DEV11_NATIVE_OTLP_EXPORTER_NOT_STARTED")
  }

  try {
    await withIncomingTradeTrace(undefined, "EVENT_PUBLISH", async () => {
      const service = container.resolve<EventOutboxModuleService>("eventOutbox")
      const locking = container.resolve<ILockingModule>(Modules.LOCKING)
      const outbox = new TransactionalOutbox(new EventOutboxRecordAdapter(service, locking))
      const id = randomUUID()
      const correlation = randomUUID()
      const originalSourceSpan = currentTraceparent()
      if (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT && !originalSourceSpan) {
        throw new Error("DEV11_NATIVE_EVENT_MISSING_EXPORTED_SOURCE_SPAN")
      }
      const event = createTenantTradeEvent(
        {
          tenantId: "tn_dev11synthetic",
          entityId: "canonical:legal-entity:dev11-synthetic",
          lifecycleStatus: "active",
          productId: "baobab-trade",
          entitled: true,
          entitlementTier: null,
          cacheTtlSeconds: 10,
          resolvedAt: new Date().toISOString(),
          correlationId: correlation,
        },
        {
          id,
          type: "com.baobab-platform.trade.order.placed.v1",
          subject: "commerce-order/dev11-rabbit-" + id,
          time: new Date().toISOString(),
          dataschema:
            "https://contracts.baobab-platform.com/erp/v1/commerce-order-consequence.schema.json",
          correlationid: correlation,
          causationid: randomUUID(),
          idempotencykey: "dev11-rabbit-connected:" + id,
          // The signed envelope points to an actual native OTel span, not a
          // fabricated child span whose parent is missing in Jaeger.
          traceparent: originalSourceSpan,
          // Synthetic only, but the bytes MUST conform to the real Shared
          // commerce-order-consequence v1 schema, not the retired projection
          // command shape. No Medusa order or IAM/CP grant is fabricated.
          data: {
            legal_entity_id: "LE-DEV11-SYNTHETIC",
            commerce_order_id: "order_dev11_" + id,
            order_version: 1,
            customer_id: "customer_dev11_synthetic",
            placed_at: new Date().toISOString(),
            currency: "USD",
            lines: [
              {
                line_id: "line_dev11_one",
                sku_id: "sku_dev11_synthetic",
                quantity: { value: "2", unit: "EA" },
                unit_price: { amount: "10.00", currency: "USD" },
                line_total: { amount: "20.00", currency: "USD" },
              },
            ],
            totals: {
              subtotal: { amount: "20.00", currency: "USD" },
              discount: { amount: "0.00", currency: "USD" },
              quoted_tax: { amount: "0.00", currency: "USD" },
              grand_total: { amount: "20.00", currency: "USD" },
            },
          },
        },
      )
      const created = await outbox.enqueue(event)
      if (created.eventId !== id || created.status !== "PENDING") {
        throw new Error("DEV11_NATIVE_OUTBOX_CREATE_FAILED")
      }
      // A second distinct immutable event lets the connected runner kill an
      // ACTUAL publisher process after broker confirmation but before its
      // PostgreSQL settlement; the recovered dispatcher must reclaim its
      // expired native lease and the ERP consumer must deduplicate delivery.
      for (const scenario of ["ambiguous", "outage", "exhausted"]) {
        await withIncomingTradeTrace(undefined, "EVENT_PUBLISH", async () => {
          const scenarioId = randomUUID()
          const scenarioEvent = {
            ...event,
            id: scenarioId,
            subject: "commerce-order/dev11-" + scenario + "-" + scenarioId,
            time: new Date().toISOString(),
            correlationid: randomUUID(),
            causationid: randomUUID(),
            traceparent: currentTraceparent(),
            idempotencykey: "dev11-rabbit-" + scenario + ":" + scenarioId,
            data: {
              ...event.data,
              commerce_order_id: "order_dev11_" + scenario + "_" + scenarioId,
            },
          }
          const row = await outbox.enqueue(scenarioEvent)
          if (row.eventId !== scenarioId || row.status !== "PENDING") {
            throw new Error("DEV11_NATIVE_SCENARIO_OUTBOX_CREATE_FAILED")
          }
        })
      }
      container
        .resolve("logger")
        .info("DEV11_NATIVE_MEDUSA_POSTGRES_OUTBOX_PREPARED; BUSINESS_ORDER_NOT_CREATED")
    })
  } finally {
    // Medusa CLI exits quickly: flush the real source span before the
    // separate publisher and ERP process attempt the causal join.
    await shutdownTradeOTel()
  }
}
