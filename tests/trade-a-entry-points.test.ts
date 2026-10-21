import { readdirSync, readFileSync, statSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { join, relative } from "node:path"
import express from "express"
import { afterEach, describe, expect, it, vi } from "vitest"
import { canonicalNativeSellerConfiguration } from "../src/baobab/orders/native-seller-configuration"
import {
  OrderAuthorityDenied,
  type OrderAuthorityEnforcementDependencies,
} from "../src/baobab/orders/order-authority-enforcement"
import {
  assertUngovernedOrderCreationDenied,
  classifyTradeRoute,
  governOrderEntry,
  PERSISTENCE_FENCED_CLASSES,
  PROTECTED_ORDER_PREFIXES,
  tradeARuntime,
  tradeProblemDocument,
} from "../src/baobab/orders/trade-a-entry-points"
import { createTradeOrderRouteGuard } from "../src/baobab/orders/trade-order-route-guard"

const org = "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c"
const scope = {
  reference: "trade:seller-config/synthetic-01/v2",
  tenantId: "tn_synthetic01",
  organisationId: org,
  market: "UG",
  engineInstanceId: "ei_tradestaging01",
  currencyScope: ["UGX"],
  salesChannelIds: ["sc_a"],
  regionIds: ["reg_ugx"],
}
const facts = {
  salesChannels: [{ id: "sc_a", is_disabled: false }],
  regions: [{ id: "reg_ugx", currency_code: "ugx", countries: ["ug"] }],
}
const canonical = canonicalNativeSellerConfiguration(scope, facts.salesChannels, facts.regions)
const native = { salesChannelId: "sc_a", regionId: "reg_ugx", currency: "ugx" }
const cart = { type: "cart" as const, id: "cart_01" }

/** Synthetic, engine-local dependencies: storage/wiring proof, never live authority. */
const syntheticDependencies = (): OrderAuthorityEnforcementDependencies & {
  recorded: unknown[]
} => {
  const now = Date.now()
  const recorded: unknown[] = []
  return {
    recorded,
    engineInstanceId: "ei_tradestaging01",
    environment: {},
    attested: {
      latestForEngine: async () => [
        {
          attestation_id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
          native_configuration_reference: scope.reference,
          canonical_configuration: canonical.canonical,
        },
      ],
    },
    facts: { read: async () => facts },
    tokens: { getAccessToken: async () => "workload-token" },
    controlPlane: {
      resolvePlatformContext: async (tenantId: string, organisationId: string) => ({
        context_id: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a01",
        tenant_id: tenantId,
        organisation_id: organisationId,
        organisation_type: "ORGANISATION",
        country_code: "UG",
        resolved_at: new Date(now).toISOString(),
        expires_at: new Date(now + 60_000).toISOString(),
      }),
    },
    authority: {
      resolveBinding: async (req) => ({
        resolution_id: "4a6b8c0d-2e4f-4a6b-8c0d-2e4f6a8b0c2d",
        ...req,
        outcome: "RESOLVED" as const,
        binding_reference: {
          binding_id: "3f9a1c2e-7b4d-4e8a-9c1f-2d6e5b4a3c21",
          binding_version: 2,
        },
        status: "ACTIVE" as const,
        effective_from: "2026-10-16T00:00:00Z",
        resolved_at: new Date(now).toISOString(),
        provider_permissions_granted: false as const,
      }),
      resolveOrderAuthority: async (req) => ({
        receivedAt: now,
        decision: {
          decision_id: "b4e9c7d1-5b2f-4e6a-8c1d-9f0b7e3a2c55",
          ...req,
          outcome: "AUTHORIZED" as const,
          tenant_id: "tn_synthetic01",
          operating_organisation_id: org,
          market: "UG",
          legal_actor_role: "SELLER_OF_RECORD" as const,
          activity: "CHECKOUT_ORDER_COMMITMENT",
          mandate_id: "7d2b9e4f-6a1c-4f3e-b8d5-0c9a8e7f6d21",
          responsible_legal_entity_id: "SYNTHETIC-LE-01",
          evidence_references: ["synthetic:mandate-evidence/01"],
          mandate_effective_from: "2026-10-15T12:00:00Z",
          evaluated_at: new Date(now).toISOString(),
          expires_at: new Date(now + 20_000).toISOString(),
          policy_reference: "ADR-SHARED-039/trade-order-authority:v1",
          provider_permissions_granted: false as const,
        },
      }),
    },
    store: {
      current: async () => null,
      record: async (a) => ({ attribution_id: "6c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f", ...a }),
    },
    receipts: {
      record: async (r) => {
        recorded.push(r)
        return { receipt_id: "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a", ...r }
      },
    },
  }
}

// Any declared "production" is production (LA-05C8); staging declares staging only.
const STAGING = { baobab: "staging", deployment: "staging" }
const PRODUCTION = { node: "production" }
const SANDBOX = { node: "test" }
const ENFORCED = { node: "test", enabled: "true" }

describe("TA-06 runtime classification", () => {
  it.each([
    [{}, "PRODUCTION"],
    [PRODUCTION, "PRODUCTION"],
    [{ node: "preview" }, "PRODUCTION"],
    [{ node: "staging" }, "PROTECTED"],
    [{ ...STAGING, enabled: "true" }, "PROTECTED"],
    [SANDBOX, "LOCAL_SANDBOX"],
    [ENFORCED, "LOCAL_ENFORCED"],
  ] as const)("%j is %s", (env, runtime) => {
    expect(tradeARuntime(env)).toBe(runtime)
  })

  it("certifies no persistence boundary in TA-06", () => {
    expect(PERSISTENCE_FENCED_CLASSES.size).toBe(0)
  })
})

describe("TA-06 governOrderEntry", () => {
  it.each([
    ["production", PRODUCTION, "PROTECTED_RUNTIME"],
    ["enabled production", { ...PRODUCTION, enabled: "true" }, "PROTECTED_RUNTIME"],
    ["staging", STAGING, "PERSISTENCE_BOUNDARY_NOT_CERTIFIED"],
    ["enabled staging", { ...STAGING, enabled: "true" }, "PERSISTENCE_BOUNDARY_NOT_CERTIFIED"],
  ] as const)(
    "denies every Trade-A class in %s before any dependency",
    async (_n, env, outcome) => {
      for (const [cls, type] of [
        ["trade.order.commit", "cart"],
        ["trade.order.create", "order"],
        ["trade.draft-order.finalize", "draft_order"],
      ] as const) {
        const resolve = vi.fn(syntheticDependencies)
        const error = await governOrderEntry(
          cls,
          { type, id: "x_01" },
          native,
          "r/1",
          resolve,
          env,
        ).catch((e) => e)
        expect(error).toBeInstanceOf(OrderAuthorityDenied)
        expect(error).toMatchObject({
          outcome,
          problem: { status: 403, code: "TRADE_OPERATION_NOT_AUTHORISED" },
        })
        expect(resolve).not.toHaveBeenCalled()
      }
    },
  )

  it("keeps the explicit local sandbox unchanged and touches nothing", async () => {
    const resolve = vi.fn(syntheticDependencies)
    await expect(
      governOrderEntry("trade.order.commit", cart, native, "r/1", resolve, SANDBOX),
    ).resolves.toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })

  it("runs the full PEP when enforcement is enabled locally and records a receipt", async () => {
    const deps = syntheticDependencies()
    const receipt = await governOrderEntry(
      "trade.order.commit",
      cart,
      native,
      "cart/cart_01/complete/1",
      () => deps,
      ENFORCED,
    )
    expect(receipt).toMatchObject({
      operation_class: "trade.order.commit",
      operation_reference: "cart/cart_01/complete/1",
      mandate_id: "7d2b9e4f-6a1c-4f3e-b8d5-0c9a8e7f6d21",
    })
    expect(deps.recorded).toHaveLength(1)
  })

  it("denies locally, with 503 and no receipt, when trusted dependencies are missing", async () => {
    const error = await governOrderEntry(
      "trade.order.commit",
      cart,
      native,
      "r/1",
      () => {
        throw new Error("Trade-A order authority requires BAOBAB_CONTROL_PLANE_BASE_URL")
      },
      ENFORCED,
    ).catch((e) => e)
    expect(error).toMatchObject({ outcome: "UNAVAILABLE", problem: { status: 503 } })
  })

  it("never lets a local denial through: a wrong class/record pairing is refused", async () => {
    const deps = syntheticDependencies()
    await expect(
      governOrderEntry(
        "trade.order.commit",
        { type: "order", id: "o_1" },
        native,
        "r/1",
        () => deps,
        ENFORCED,
      ),
    ).rejects.toMatchObject({ outcome: "UNCATALOGUED_OPERATION" })
    expect(deps.recorded).toHaveLength(0)
  })
})

describe("TA-06 createOrderWorkflow has no governed commit point", () => {
  it.each([
    [PRODUCTION, "PROTECTED_RUNTIME"],
    [STAGING, "NO_GOVERNED_COMMIT_POINT"],
    [ENFORCED, "NO_GOVERNED_COMMIT_POINT"],
  ] as const)("%j denies as %s", (env, outcome) => {
    expect(() => assertUngovernedOrderCreationDenied(env)).toThrow(
      expect.objectContaining({ outcome, problem: expect.objectContaining({ status: 403 }) }),
    )
  })

  it("leaves the explicit local sandbox unchanged", () => {
    expect(() => assertUngovernedOrderCreationDenied(SANDBOX)).not.toThrow()
  })
})

/** Every mutating native Medusa route file, from the installed @medusajs/medusa. */
function nativeMutationRoutes(): { method: string; path: string }[] {
  const root = join(require.resolve("@medusajs/medusa/package.json"), "..", "dist", "api")
  const found: { method: string; path: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name === "route.js") {
        const source = readFileSync(full, "utf8")
        const path = `/${relative(root, dir)}`.replace(/\[([^\]]+)\]/g, "Ab_$1_01X")
        for (const method of ["POST", "PUT", "PATCH", "DELETE"])
          if (new RegExp(`exports\\.${method}\\b`).test(source)) found.push({ method, path })
      }
    }
  }
  walk(root)
  return found
}

describe("TA-06 deny by name", () => {
  const routes = nativeMutationRoutes()
  const protectedRoutes = routes.filter((r) =>
    PROTECTED_ORDER_PREFIXES.some((p) => r.path === p || r.path.startsWith(`${p}/`)),
  )

  it("inventories the installed native order and money mutations", () => {
    // Guards against a silently empty inventory after a Medusa upgrade.
    expect(protectedRoutes.length).toBeGreaterThan(100)
    expect(protectedRoutes).toContainEqual({
      method: "POST",
      path: "/admin/draft-orders/Ab_id_01X/convert-to-order",
    })
    expect(protectedRoutes).toContainEqual({
      method: "POST",
      path: "/store/carts/Ab_id_01X/complete",
    })
  })

  it("classifies every native order and money mutation as Trade-A, allowlisted or denied", () => {
    const decisions = protectedRoutes.map((r) => ({
      ...r,
      decision: classifyTradeRoute(r.method, r.path),
    }))
    const passed = decisions
      .filter((d) => d.decision.kind === "pass")
      .map((d) => `${d.method} ${d.path}`)
    // Only cart building and the history export pass; nothing that commits, edits or moves money.
    for (const p of passed)
      expect(p).toMatch(
        /^(?:(?:POST|DELETE) \/store\/carts(?!\/[^/]+\/complete$)|POST \/admin\/orders\/export$)/,
      )
    expect(passed).not.toContain("POST /store/carts/Ab_id_01X/complete")
    const tradeA = decisions.filter((d) => d.decision.kind === "trade-a")
    expect(tradeA.map((d) => [d.path, d.decision])).toEqual(
      expect.arrayContaining([
        [
          "/store/carts/Ab_id_01X/complete",
          {
            kind: "trade-a",
            operationClass: "trade.order.commit",
            enforcedBy: "workflow",
            subjectId: "Ab_id_01X",
          },
        ],
        [
          "/admin/draft-orders/Ab_id_01X/convert-to-order",
          {
            kind: "trade-a",
            operationClass: "trade.draft-order.finalize",
            enforcedBy: "route",
            subjectId: "Ab_id_01X",
          },
        ],
      ]),
    )
    expect(tradeA).toHaveLength(2)
    for (const route of [
      "POST /admin/draft-orders",
      "POST /admin/orders/Ab_id_01X/cancel",
      "POST /admin/orders/Ab_id_01X/complete",
      "POST /admin/orders/Ab_id_01X/transfer",
      "POST /admin/order-edits/Ab_id_01X/confirm",
      "POST /admin/claims",
      "POST /admin/exchanges",
      "POST /admin/returns/Ab_id_01X/receive/confirm",
      "POST /admin/payments/Ab_id_01X/capture",
      "POST /admin/payments/Ab_id_01X/refund",
      "POST /admin/payment-collections/Ab_id_01X/mark-as-paid",
      "POST /admin/orders/Ab_id_01X/fulfillments",
      "POST /admin/fulfillments/Ab_id_01X/shipment",
      "POST /admin/reservations",
      "POST /store/orders/Ab_id_01X/transfer/accept",
      "POST /store/returns",
      "POST /store/payment-collections/Ab_id_01X/payment-sessions",
    ]) {
      const [method, path] = route.split(" ")
      expect(decisions, route).toContainEqual({
        method,
        path,
        decision: { kind: "denied", outcome: "UNCATALOGUED_OPERATION" },
      })
    }
  })

  it("classifies by effect regardless of case, trailing slash, repeated slash or query", () => {
    for (const path of [
      "/ADMIN/Draft-Orders/order_01JABC/Convert-To-Order",
      "/admin/draft-orders/order_01JABC/convert-to-order/",
      "/admin//draft-orders/order_01JABC/convert-to-order?x=1",
    ])
      expect(classifyTradeRoute("post", path)).toMatchObject({
        kind: "trade-a",
        operationClass: "trade.draft-order.finalize",
        subjectId: "order_01JABC",
      })
    expect(classifyTradeRoute("POST", "/Store/Carts/cart_01/COMPLETE")).toMatchObject({
      operationClass: "trade.order.commit",
    })
    expect(classifyTradeRoute("POST", "/admin/orders/ord_1/%63ancel")).toMatchObject({
      kind: "denied",
    })
    expect(classifyTradeRoute("GET", "/admin/orders/ord_1")).toEqual({ kind: "pass" })
    expect(classifyTradeRoute("POST", "/admin/products")).toEqual({ kind: "pass" })
  })

  it("builds RFC 9457 documents that never echo internals", () => {
    const doc = tradeProblemDocument(
      new Error("relation trade_x violates constraint"),
      "/admin/x?y=1",
      "nope",
    )
    expect(doc).toMatchObject({
      status: 503,
      code: "TRADE_AUTHORITY_UNAVAILABLE",
      retryable: true,
      instance: "/admin/x",
    })
    expect(JSON.stringify(doc)).not.toContain("constraint")
    expect(doc.correlation_id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe("TA-06 HTTP boundary (real Express routing, as Medusa mounts it)", () => {
  let server: Server | undefined
  afterEach(() => server?.close())

  const start = async (env: Record<string, string>) => {
    const handled: string[] = []
    const dependencies = vi.fn(() => syntheticDependencies())
    const app = express()
    app.use((req, _res, next) => {
      ;(req as unknown as { scope: unknown }).scope = {
        resolve: () => ({
          retrieveOrder: async (id: string) => ({
            id,
            is_draft_order: id.startsWith("draft"),
            sales_channel_id: "sc_a",
            region_id: "reg_ugx",
            currency_code: "ugx",
          }),
        }),
      }
      next()
    })
    const guard = createTradeOrderRouteGuard({ environment: () => env, dependencies })
    // Medusa registers a middleware without `methods` via app.use(matcher, ...).
    for (const prefix of PROTECTED_ORDER_PREFIXES) app.use(`${prefix}*`, guard as never)
    app.all("*", (req, res) => {
      handled.push(`${req.method} ${req.path}`)
      res.status(200).json({ native: true })
    })
    const listening = createServer(app)
    server = listening
    await new Promise<void>((resolve) => listening.listen(0, resolve))
    const base = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`
    const call = (method: string, path: string) => fetch(`${base}${path}`, { method })
    return { call, handled, dependencies }
  }

  it.each([
    ["staging", STAGING],
    ["production", PRODUCTION],
  ] as const)(
    "denies order creation and money routes in %s and never reaches Medusa",
    async (_n, env) => {
      const { call, handled, dependencies } = await start(env)
      for (const [method, path] of [
        ["POST", "/store/carts/cart_01/complete"],
        ["POST", "/admin/draft-orders/draft_01/convert-to-order"],
        ["POST", "/admin/draft-orders"],
        ["POST", "/admin/orders/ord_1/cancel"],
        ["POST", "/admin/payments/pay_1/refund"],
        ["POST", "/ADMIN/PAYMENTS/pay_1/CAPTURE/"],
        ["DELETE", "/admin/reservations/res_1"],
        ["POST", "/store/payment-collections/pc_1/payment-sessions"],
      ]) {
        const response = await call(method, path)
        expect(response.status, `${method} ${path}`).toBe(403)
        expect(response.headers.get("content-type")).toBe("application/problem+json")
        expect(response.headers.get("cache-control")).toBe("no-store")
        expect(await response.json()).toMatchObject({
          status: 403,
          code: "TRADE_OPERATION_NOT_AUTHORISED",
        })
      }
      expect(handled).toEqual([])
      expect(dependencies).not.toHaveBeenCalled()
    },
  )

  it("keeps historical reads and cart building available in protected runtimes", async () => {
    const { call, handled } = await start(STAGING)
    expect((await call("GET", "/admin/orders/ord_1")).status).toBe(200)
    expect((await call("POST", "/store/carts/cart_01/line-items")).status).toBe(200)
    expect((await call("POST", "/admin/orders/export")).status).toBe(200)
    expect(handled).toHaveLength(3)
  })

  it("runs the draft-finalisation PEP at the route when enforcement is enabled locally", async () => {
    const { call, handled, dependencies } = await start(ENFORCED)
    expect((await call("POST", "/admin/draft-orders/draft_01/convert-to-order")).status).toBe(200)
    expect(dependencies).toHaveBeenCalledTimes(1)
    // A non-draft order is a lifecycle error, answered 409 without reaching Medusa.
    const notDraft = await call("POST", "/admin/draft-orders/order_01/convert-to-order")
    expect(notDraft.status).toBe(409)
    expect(handled).toEqual(["POST /admin/draft-orders/draft_01/convert-to-order"])
  })

  it("leaves the explicit local sandbox to Medusa", async () => {
    const { call, handled, dependencies } = await start(SANDBOX)
    expect((await call("POST", "/admin/orders/ord_1/cancel")).status).toBe(200)
    expect((await call("POST", "/admin/draft-orders/draft_01/convert-to-order")).status).toBe(200)
    expect(handled).toHaveLength(2)
    expect(dependencies).not.toHaveBeenCalled()
  })
})

describe("TA-06 service boundary inventory", () => {
  it("has no in-repo caller that creates or finalises an order around the guarded hooks", () => {
    // completeCartWorkflow and createOrderWorkflow runs reach their guarded
    // hooks; these entry points have none and would bypass TA-06 until TA-07.
    const bypass =
      /\b(?:convertDraftOrderWorkflow|convertDraftOrderStep|createOrdersStep)\b|\.createOrders\(|is_draft_order:\s*false/g
    const root = join(__dirname, "..", "src")
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.ts$/.test(name)) {
          const code = readFileSync(full, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/.*$/gm, "$1")
          const hits = code.match(bypass)
          if (hits) offenders.push(`${relative(root, full)}: ${hits.join(",")}`)
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
