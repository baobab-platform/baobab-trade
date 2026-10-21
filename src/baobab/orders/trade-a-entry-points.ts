/**
 * ADR-SHARED-039 Trade-A TA-06: every native Medusa entry point that creates
 * or commits an order reaches ONE classification and authorization rule.
 *
 * - Cart completion (store route, payment webhook, direct workflow run):
 *   completeCartWorkflow's validate hook, class trade.order.commit.
 * - Draft finalisation (admin convert-to-order): the HTTP guard, class
 *   trade.draft-order.finalize. Medusa 2.21 gives convertDraftOrderWorkflow
 *   no hook; a non-HTTP run is closed at persistence (TA-07).
 * - Direct and admin order creation (createOrderWorkflow, including draft
 *   creation): Medusa offers no pre-commit point that knows the record, so
 *   it stays DENIED in protected runtimes. trade.order.create is never
 *   honoured until a governed pre-commit point exists.
 * - Order edits, cancellations, claims, exchanges, returns, transfers,
 *   fulfilment, reservations and payment collection, capture and refund
 *   (Trade-B/C): DENIED by name in protected runtimes. Nothing here
 *   activates them.
 *
 * Protected runtimes (staging, production, unknown) deny every Trade-A
 * class until its persistence boundary is certified. That is TA-07's hard
 * dependency, recorded in code below and never a runtime flag. Production
 * stays denied whatever is certified. Local runtimes keep the existing
 * synthetic sandbox path unless Trade-A enforcement is explicitly enabled,
 * in which case the full PEP runs.
 */
import { randomUUID } from "node:crypto"
import type { BaobabProblemDetails } from "../contracts/problem-details"
import type { TradeAOperationClass } from "../control-plane/trade-order-authority"
import type { CommitmentSubject } from "./commitment-attribution"
import { resolveNativeCheckoutEnvironment } from "./native-cart-legal-seller"
import type { NativeCommitmentScope } from "./native-configuration-resolver"
import {
  enforceOrderAuthority,
  OrderAuthorityDenied,
  tradeAuthorityProblem,
  type OrderAuthorityEnforcementDependencies,
  type OrderAuthorityReceipt,
} from "./order-authority-enforcement"
import type { PersistencePostureVerdict } from "./persistence-posture"

/** Explicit, non-production enablement of the Trade-A PEP. Never activation. */
export const TRADE_A_ENFORCEMENT_ENV = "BAOBAB_TRADE_A_ORDER_AUTHORITY_ENABLED"

/**
 * Classes certified to commit in a protected (non-production) runtime.
 *
 * TA-07 (Migration20261021090000) installs the PostgreSQL commit fences for
 * trade.order.commit and trade.draft-order.finalize. TA-08 certifies them
 * with the real-runtime acceptance (acceptance/trade-a) and the per-operation
 * posture check (assertPersistenceEnforced), added in the same change.
 * Certification is not activation: every operation still needs a current CP
 * decision under an ACTIVE binding and mandate, and production stays denied.
 * trade.order.create has no governed commit point and stays out.
 */
export const PERSISTENCE_FENCED_CLASSES: ReadonlySet<TradeAOperationClass> = new Set([
  "trade.order.commit",
  "trade.draft-order.finalize",
])

export type TradeAEnvironment = {
  node?: string
  baobab?: string
  deployment?: string
  enabled?: string
}

export const tradeAEnvironment = (env: NodeJS.ProcessEnv = process.env): TradeAEnvironment => ({
  node: env.NODE_ENV,
  baobab: env.BAOBAB_ENVIRONMENT,
  deployment: env.BAOBAB_DEPLOYMENT_ENV,
  enabled: env[TRADE_A_ENFORCEMENT_ENV],
})

export type TradeARuntime = "PRODUCTION" | "PROTECTED" | "LOCAL_ENFORCED" | "LOCAL_SANDBOX"

export function tradeARuntime(env: TradeAEnvironment): TradeARuntime {
  const profile = resolveNativeCheckoutEnvironment(env ?? {})
  if (profile.production) return "PRODUCTION"
  if (profile.staging) return "PROTECTED"
  return env?.enabled === "true" ? "LOCAL_ENFORCED" : "LOCAL_SANDBOX"
}

const deny = (outcome: string): never => {
  throw new OrderAuthorityDenied(outcome, tradeAuthorityProblem(outcome))
}

/**
 * The single Trade-A gate behind every hook and route. It returns the
 * recorded receipt, or null only in the explicit local sandbox.
 */
export async function governOrderEntry(
  operationClass: TradeAOperationClass,
  subject: CommitmentSubject,
  native: NativeCommitmentScope,
  operationReference: string,
  resolveDependencies: () => OrderAuthorityEnforcementDependencies,
  env: TradeAEnvironment,
): Promise<OrderAuthorityReceipt | null> {
  const runtime = tradeARuntime(env)
  if (runtime === "PRODUCTION") deny("PROTECTED_RUNTIME")
  if (runtime === "PROTECTED" && !PERSISTENCE_FENCED_CLASSES.has(operationClass))
    deny("PERSISTENCE_BOUNDARY_NOT_CERTIFIED")
  if (runtime === "LOCAL_SANDBOX") return null
  let deps: OrderAuthorityEnforcementDependencies
  try {
    deps = resolveDependencies()
  } catch {
    return deny("UNAVAILABLE")
  }
  if (runtime === "PROTECTED") await assertPersistenceEnforced(deps)
  return enforceOrderAuthority(operationClass, subject, native, operationReference, {
    ...deps,
    environment: env,
  })
}

/**
 * TA-08: a certified class is honoured in a protected runtime only while its
 * database shows the ENFORCED posture and every active TA-07 fence. The
 * check precedes any CP call, so a misconfigured database never obtains or
 * records authority.
 */
async function assertPersistenceEnforced(
  deps: OrderAuthorityEnforcementDependencies,
): Promise<void> {
  const posture = deps.posture
  if (!posture) return deny("UNAVAILABLE")
  let verdict: PersistencePostureVerdict
  try {
    verdict = await posture.verify()
  } catch {
    return deny("UNAVAILABLE")
  }
  if (!verdict.enforced) {
    // The reason is an operator signal only; callers see the generic 403.
    console.error(`Trade-A persistence posture refused: ${verdict.reason}`)
    deny("PERSISTENCE_POSTURE_NOT_ENFORCED")
  }
}

/**
 * createOrderWorkflow (direct, admin and draft creation) exposes no
 * pre-commit point that knows the record's channel, currency or identity.
 * Outside the explicit local sandbox it is denied, never guessed.
 */
export function assertUngovernedOrderCreationDenied(env: TradeAEnvironment): void {
  const runtime = tradeARuntime(env)
  if (runtime === "PRODUCTION") deny("PROTECTED_RUNTIME")
  if (runtime !== "LOCAL_SANDBOX") deny("NO_GOVERNED_COMMIT_POINT")
}

/** A Trade-A operation reference: printable ASCII, unique per attempt. */
export const tradeAOperationReference = (subject: CommitmentSubject, action: string): string =>
  `${subject.type}/${subject.id}/${action}/${randomUUID()}`

export type TradeRouteDecision =
  | { kind: "pass" }
  | {
      kind: "trade-a"
      operationClass: TradeAOperationClass
      enforcedBy: "workflow" | "route"
      /** The native record named by the path, case preserved. */
      subjectId: string
    }
  | { kind: "denied"; outcome: string }

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/** Native order and money surfaces. Every mutation under them is classified here. */
export const PROTECTED_ORDER_PREFIXES = [
  "/admin/orders",
  "/admin/draft-orders",
  "/admin/order-edits",
  "/admin/order-changes",
  "/admin/claims",
  "/admin/exchanges",
  "/admin/returns",
  "/admin/payments",
  "/admin/payment-collections",
  "/admin/fulfillments",
  "/admin/reservations",
  "/store/carts",
  "/store/orders",
  "/store/returns",
  "/store/payment-collections",
] as const

// Express matches routes case-insensitively, so classification does too.
const route = (pattern: string) => new RegExp(`^${pattern.replace(/:id/g, "([^/]+)")}$`, "i")

type Classified = { method: string; path: RegExp } & (
  | { decision: "pass" }
  | { decision: "trade-a"; operationClass: TradeAOperationClass; enforcedBy: "workflow" | "route" }
)

/** The explicit allowlist: the only mutations under the prefixes that are not denied. */
const CLASSIFIED: readonly Classified[] = [
  {
    method: "POST",
    path: route("/store/carts/:id/complete"),
    decision: "trade-a",
    operationClass: "trade.order.commit",
    enforcedBy: "workflow",
  },
  {
    method: "POST",
    path: route("/admin/draft-orders/:id/convert-to-order"),
    decision: "trade-a",
    operationClass: "trade.draft-order.finalize",
    enforcedBy: "route",
  },
  // Exporting order history is a read and creates no commercial obligation.
  { method: "POST", path: route("/admin/orders/export"), decision: "pass" },
]

/** Cart building is not order commitment and is not a protected order surface. */
const CART_BUILDING = /^\/store\/carts(?:\/[^/]+(?:\/(?!complete$)[^/]+)*)?$/i

const normalise = (path: string): string => {
  const collapsed = (path ?? "").split(/[?#]/, 1)[0].replace(/\/{2,}/g, "/")
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed
}

export function classifyTradeRoute(method: string, path: string): TradeRouteDecision {
  const verb = (method ?? "").toUpperCase()
  const p = normalise(path)
  const lower = p.toLowerCase()
  if (
    !PROTECTED_ORDER_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`))
  )
    return { kind: "pass" }
  // Historical reads remain under independent IAM and tenant isolation.
  if (!MUTATIONS.has(verb)) return { kind: "pass" }
  for (const c of CLASSIFIED) {
    const match = c.method === verb ? c.path.exec(p) : null
    if (!match) continue
    if (c.decision === "pass") return { kind: "pass" }
    return {
      kind: "trade-a",
      operationClass: c.operationClass,
      enforcedBy: c.enforcedBy,
      subjectId: match[1],
    }
  }
  if (CART_BUILDING.test(p)) return { kind: "pass" }
  return { kind: "denied", outcome: "UNCATALOGUED_OPERATION" }
}

const DENIAL = /^Trade-A order authority denied \(([A-Z][A-Z0-9_]{0,63})\)/
// The TA-05/TA-07 PostgreSQL fences raise "Trade-A denied: ..." inside a write.
const FENCE = /\bTrade-A denied:/

/**
 * A Trade-A denial however it reaches an error handler: thrown directly (the
 * route PEP), serialised by Medusa's workflow engine (the completeCartWorkflow
 * hook rethrows a plain { message } object), or raised by a TA-07 fence in
 * PostgreSQL. Anything else is not Trade-A's to answer and returns null.
 */
export function tradeADenialOf(error: unknown): OrderAuthorityDenied | null {
  if (error instanceof OrderAuthorityDenied) return error
  const message = (error as { message?: unknown } | null | undefined)?.message
  if (typeof message !== "string") return null
  const outcome =
    DENIAL.exec(message)?.[1] ?? (FENCE.test(message) ? "PERSISTENCE_FENCE_REFUSED" : null)
  return outcome ? new OrderAuthorityDenied(outcome, tradeAuthorityProblem(outcome)) : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** RFC 9457 document per Shared errors/v1; never echoes SQL, tokens or CP detail. */
export function tradeProblemDocument(
  error: unknown,
  instance: string,
  correlationId?: string,
): BaobabProblemDetails {
  const problem =
    error instanceof OrderAuthorityDenied ? error.problem : tradeAuthorityProblem("UNAVAILABLE")
  return {
    type: `https://problems.baobab-platform.com/trade/${problem.code.toLowerCase().replace(/_/g, "-")}`,
    title:
      problem.status === 503
        ? "Trade authority unavailable"
        : problem.status === 409
          ? "Invalid order lifecycle state"
          : "Trade operation not authorised",
    status: problem.status,
    detail: problem.detail,
    instance: normalise(instance).slice(0, 512),
    code: problem.code,
    correlation_id: correlationId && UUID.test(correlationId) ? correlationId : randomUUID(),
    retryable: problem.status === 503,
  }
}
