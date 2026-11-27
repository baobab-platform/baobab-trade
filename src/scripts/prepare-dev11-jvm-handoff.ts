/**
 * Disposable same-event Trade outbox -> real ERP/JVM qualification source.
 * Business inputs are explicitly synthetic; no buyer/seller authority or
 * native Medusa order is fabricated. Reuses #189's integer valuation and
 * #188's actual Medusa outbox/locking/OTLP implementation. The returned IDs
 * identify persisted envelopes; the ERP driver must never regenerate them.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { lstatSync, readFileSync, writeFileSync } from "node:fs"
import type { ExecArgs, ILockingModule } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { buildFinalBuyerCommitmentValuation } from "../baobab/b2b/buyer-commitment-valuation"
import { erpOrderConsequenceSchema } from "../baobab/contracts/authority-validation"
import { TransactionalOutbox, createTenantTradeEvent } from "../baobab/events"
import { EventOutboxRecordAdapter } from "../baobab/events/outbox-record-adapter"
import { withIncomingTradeTrace } from "../baobab/observability/tracing"
import {
  startTradeOTel,
  shutdownTradeOTel,
  tradeOTelConfigured,
} from "../baobab/observability/otel-bootstrap"
import type EventOutboxModuleService from "../modules/event-outbox/service"

export default async function ({ container }: ExecArgs) {
  const input = process.env.BAOBAB_DEV11_JVM_INPUT
  const output = process.env.BAOBAB_DEV11_JVM_HANDOFF
  const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/absent")
  assert(
    process.env.NODE_ENV === "test" &&
      process.env.BAOBAB_ENVIRONMENT === "development" &&
      process.env.BAOBAB_DEV11_JVM_COMPONENT_REQUIRED === "true" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.pathname === "/baobab_trade_jvm_test" &&
      input &&
      output,
    "DEV11_DISPOSABLE_TRADE_JVM_PROFILE_REQUIRED",
  )
  const stat = lstatSync(input)
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid?.() &&
      (stat.mode & 0o077) === 0 &&
      stat.size <= 4096,
    "DEV11_PRIVATE_SOURCE_PACKET_REQUIRED",
  )
  const packet = JSON.parse(readFileSync(input, "utf8"))
  assert.deepEqual(
    Object.keys(packet).sort(),
    ["schema", "tenant_id", "legal_entity_id", "customer_id", "sku_id", "unit"].sort(),
  )
  assert(
    packet.schema === "baobab.dev11.synthetic-jvm-source.v1" &&
      /^tn_[a-z0-9]{3,60}$/.test(packet.tenant_id) &&
      /^LE-[A-Z0-9-]+$/.test(packet.legal_entity_id) &&
      [packet.customer_id, packet.sku_id].every(
        (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value),
      ) &&
      typeof packet.unit === "string" &&
      /^[A-Z0-9]{1,8}$/.test(packet.unit),
    "DEV11_SOURCE_PACKET_INVALID",
  )
  startTradeOTel()
  assert(tradeOTelConfigured(), "DEV11_REAL_SOURCE_EXPORTER_REQUIRED")
  const events: Record<string, string> = {}
  try {
    await withIncomingTradeTrace(undefined, "EVENT_PUBLISH", async () => {
      const outbox = new TransactionalOutbox(
        new EventOutboxRecordAdapter(
          container.resolve<EventOutboxModuleService>("eventOutbox"),
          container.resolve<ILockingModule>(Modules.LOCKING),
        ),
      )
      for (const label of ["positive", "ambiguous", "denied"] as const) {
        const id = randomUUID(),
          order = "order_" + randomUUID().replaceAll("-", ""),
          correlation = randomUUID()
        const now = new Date().toISOString()
        // Pure valuation over declared SYNTHETIC fixture facts. This never
        // masquerades as the still-required native final-pricing source.
        const valuation = buildFinalBuyerCommitmentValuation({
          resource_id: order,
          resource_version: 1,
          transaction_digest: "sha256:" + "a".repeat(64),
          currency: "USD",
          basis: "FINAL_PRICED",
          components: [
            {
              component_kind: "MERCHANDISE",
              amount_minor: 2000,
              determination: "FINAL",
              source_reference: "fixture_line_01",
            },
          ],
        })
        assert.equal(valuation.buyer_commitment_amount_minor, 2000)
        const event = createTenantTradeEvent(
          {
            tenantId: packet.tenant_id,
            entityId: packet.legal_entity_id,
            lifecycleStatus: "active",
            productId: "baobab-trade",
            entitled: true,
            entitlementTier: null,
            cacheTtlSeconds: 10,
            resolvedAt: now,
            correlationId: correlation,
          },
          {
            id,
            type: "com.baobab-platform.trade.order.placed.v1",
            subject: "commerce-order/" + order,
            time: now,
            dataschema:
              "https://contracts.baobab-platform.com/erp/v1/commerce-order-consequence.schema.json",
            correlationid: correlation,
            causationid: randomUUID(),
            idempotencykey: "dev11-jvm-persisted:" + id,
            data: {
              legal_entity_id: packet.legal_entity_id,
              commerce_order_id: order,
              order_version: 1,
              customer_id: packet.customer_id,
              placed_at: now,
              currency: "USD",
              lines: [
                {
                  line_id: "line_dev11_jvm",
                  sku_id: packet.sku_id,
                  quantity: { value: "2", unit: packet.unit },
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
        assert(erpOrderConsequenceSchema(event.data), "DEV11_PINNED_ERP_PAYLOAD_INVALID")
        const stored = await outbox.enqueue(event)
        assert(stored.eventId === id && stored.status === "PENDING")
        events[label] = id
      }
    })
  } finally {
    await shutdownTradeOTel()
  }
  writeFileSync(
    output,
    JSON.stringify({
      schema: "baobab.dev11.persisted-trade-event-handoff.v1",
      source_sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      synthetic_business_input: true,
      buyer_commitment_qualified: false,
      events,
    }) + "\n",
    { mode: 0o600, flag: "wx" },
  )
  console.info("DEV11_ACTUAL_TRADE_OUTBOX_IDS_RETAINED; BUYER_COMMITMENT_NOT_QUALIFIED")
}
