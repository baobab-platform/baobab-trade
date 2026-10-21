/**
 * ADR-SHARED-039 §6 / Trade-A TA-06: the HTTP boundary for native Medusa
 * order and money routes. It runs after Medusa authentication (so a missing
 * or invalid credential is still 401) and before every native handler. A
 * denial answers RFC 9457 with no-store and never falls through to Medusa.
 * Administrator privileges cannot bypass it.
 */
import type {
  MedusaErrorHandlerFunction,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { IOrderModuleService, MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { OrderAuthorityDenied, tradeAuthorityProblem } from "./order-authority-enforcement"
import {
  classifyTradeRoute,
  governOrderEntry,
  PERSISTENCE_FENCED_CLASSES,
  tradeAEnvironment,
  tradeADenialOf,
  tradeAOperationReference,
  tradeARuntime,
  tradeProblemDocument,
  type TradeAEnvironment,
} from "./trade-a-entry-points"
import { tradeOrderAuthorityDependencies } from "./trade-a-runtime"

type Deps = {
  environment: () => TradeAEnvironment
  dependencies: typeof tradeOrderAuthorityDependencies
}

const denied = (outcome: string) =>
  new OrderAuthorityDenied(outcome, tradeAuthorityProblem(outcome))

const path = (req: MedusaRequest): string => (req.originalUrl ?? req.url ?? "").split("?", 1)[0]

function respond(req: MedusaRequest, res: MedusaResponse, error: unknown): void {
  const header = req.headers?.["x-correlation-id"]
  const document = tradeProblemDocument(
    error,
    path(req),
    typeof header === "string" ? header : undefined,
  )
  res.setHeader("Content-Type", "application/problem+json")
  res.setHeader("Cache-Control", "no-store")
  res.statusCode = document.status
  res.end(JSON.stringify(document))
}

async function draftScope(container: MedusaContainer, id: string) {
  const orders = container.resolve<IOrderModuleService>(Modules.ORDER)
  const draft = await orders.retrieveOrder(id, {
    select: ["id", "is_draft_order", "sales_channel_id", "region_id", "currency_code"],
  })
  // Finalisation applies only to a server-recorded draft; anything else is a lifecycle error.
  if (!draft?.is_draft_order) throw denied("INVALID_LIFECYCLE_STATE")
  return {
    salesChannelId: String(draft.sales_channel_id ?? ""),
    regionId: String(draft.region_id ?? ""),
    currency: String(draft.currency_code ?? ""),
  }
}

export function createTradeOrderRouteGuard(
  deps: Deps = {
    environment: () => tradeAEnvironment(),
    dependencies: tradeOrderAuthorityDependencies,
  },
) {
  return async function tradeOrderRouteGuard(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction,
  ): Promise<void> {
    const decision = classifyTradeRoute(req.method, path(req))
    if (decision.kind === "pass") return next()
    const env = deps.environment()
    const runtime = tradeARuntime(env)
    const local = runtime === "LOCAL_SANDBOX" || runtime === "LOCAL_ENFORCED"
    try {
      if (decision.kind === "denied") {
        // Trade-B/C surfaces: not catalogued as supported, denied by name.
        if (local) return next()
        throw denied(runtime === "PRODUCTION" ? "PROTECTED_RUNTIME" : decision.outcome)
      }
      if (decision.enforcedBy === "workflow") {
        // The workflow hook is the PEP; refuse early only where it would refuse anyway.
        if (runtime === "PRODUCTION") throw denied("PROTECTED_RUNTIME")
        if (!local && !PERSISTENCE_FENCED_CLASSES.has(decision.operationClass))
          throw denied("PERSISTENCE_BOUNDARY_NOT_CERTIFIED")
        return next()
      }
      // No native hook exists (convertDraftOrderWorkflow): this route is the PEP.
      if (runtime === "LOCAL_SANDBOX") return next()
      // A wildcard mount has no route params: the classified path names the draft.
      const id = decision.subjectId
      const subject = { type: "draft_order" as const, id }
      const native =
        runtime === "PRODUCTION" ||
        (!local && !PERSISTENCE_FENCED_CLASSES.has(decision.operationClass))
          ? { salesChannelId: "", regionId: "", currency: "" }
          : await draftScope(req.scope, id)
      await governOrderEntry(
        decision.operationClass,
        subject,
        native,
        tradeAOperationReference(subject, "finalize"),
        () => deps.dependencies(req.scope),
        env,
      )
      return next()
    } catch (error) {
      respond(req, res, error)
    }
  }
}

export const tradeOrderRouteGuard = createTradeOrderRouteGuard()

/**
 * TA-08: certified classes are enforced inside native handlers (the
 * completeCartWorkflow hook and the persistence fences), whose failures reach
 * Medusa's error handler rather than this guard. Without this, a Trade-A
 * denial at checkout would answer Medusa's generic 500. A recognised denial
 * answers the same RFC 9457 document as the guard; every other error is left
 * to Medusa's own handler unchanged.
 */
export function createTradeAErrorHandler(fallback: MedusaErrorHandlerFunction) {
  return function tradeAErrorHandler(
    error: unknown,
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction,
  ) {
    const denial = tradeADenialOf(error)
    if (!denial || res.headersSent) return fallback(error, req, res, next)
    respond(req, res, denial)
  }
}
