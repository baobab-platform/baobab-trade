import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  createPlatformTradeEvent,
  createTenantTradeEvent,
  isValidCloudEvent,
  TRADE_EVENT_SOURCE,
} from "../../src/baobab/events/event-contracts"
import type { BaobabTenantContext } from "../../src/baobab/contracts/tenant-context"
import { readYaml, validatorFor } from "./shared"

const envelope = validatorFor("contracts/events/v1/envelope.schema.json")
const registry = readYaml("contracts/events/v1/event-registry.yaml").events as Array<{
  type: string
  lifecycle: string
  producer?: string
}>
const byType = new Map(registry.map((event) => [event.type, event]))

const tenant: BaobabTenantContext = {
  tenantId: "tn_abc123",
  entityId: "ZURIBEANS",
  lifecycleStatus: "active",
  productId: "baobab-trade",
  entitled: true,
  entitlementTier: null,
  cacheTtlSeconds: 15,
  resolvedAt: "2026-10-01T10:00:00Z",
  correlationId: "7c8f131b-d8ba-4d89-b60b-a187d3944074",
}

const input = {
  id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6b",
  type: "com.baobab-platform.trade.order.placed.v1",
  subject: "order/ord_1",
  time: "2026-10-01T10:00:00Z",
  dataschema: "https://contracts.baobab-platform.com/trade/v1/order-placed.schema.json",
  correlationid: "7c8f131b-d8ba-4d89-b60b-a187d3944074",
  data: { order_id: "ord_1" },
}

describe("event envelope (events/v1/envelope.schema.json)", () => {
  it("a tenant event built by Trade conforms", () => {
    const event = createTenantTradeEvent(tenant, input)
    expect(envelope(event), JSON.stringify(envelope.errors)).toBe(true)
    expect(isValidCloudEvent(event)).toBe(true)
    expect(event.source).toBe(TRADE_EVENT_SOURCE)
  })

  it("a platform event built by Trade conforms", () => {
    const event = createPlatformTradeEvent(input)
    expect(envelope(event), JSON.stringify(envelope.errors)).toBe(true)
    expect(isValidCloudEvent(event)).toBe(true)
  })

  it("rejects the legacy com.nabhold namespace", () => {
    expect(() =>
      createPlatformTradeEvent({ ...input, type: "com.nabhold.trade.order.placed.v1" }),
    ).toThrow()
    expect(
      envelope({ ...createPlatformTradeEvent(input), type: "com.nabhold.trade.order.placed.v1" }),
    ).toBe(false)
  })
})

describe("event registry (ADR-SHARED-018)", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) return name === "migrations" ? [] : sourceFiles(full)
      return full.endsWith(".ts") ? [full] : []
    })

  const typesInSource = new Set<string>()
  for (const file of sourceFiles(resolve(__dirname, "../../src"))) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /com\.baobab-platform\.[a-z0-9.-]+\.v[0-9]+/g,
    )) {
      typesInSource.add(match[0])
    }
  }

  it("Trade's source names event types", () => {
    expect(typesInSource.size).toBeGreaterThan(0)
  })

  it.each([...typesInSource].sort())("%s is registered and ACTIVE", (type) => {
    const entry = byType.get(type)
    expect(entry, `${type} is not in event-registry.yaml`).toBeDefined()
    expect(entry?.lifecycle).toBe("ACTIVE")
  })

  it("no event Trade's source mentions uses the legacy namespace", () => {
    for (const type of typesInSource) expect(type.startsWith("com.nabhold.")).toBe(false)
  })
})
