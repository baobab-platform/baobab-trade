/**
 * Gate 17 — Store Credit. Medusa v2.20.1 has no persistent customer-wallet
 * primitive (a running balance redeemable on any future order): the only
 * native "credit" concept is an Order Credit Line — a one-off amount
 * attached to a single order. This module implements Store Credit as three
 * explicitly reasoned uses of that same native primitive, not a bespoke
 * wallet ledger — "implement only as approved native capability" per the
 * completion plan.
 *
 * A credit line is only a real, accounted-for native entity when it is
 * created through Medusa's order-change machinery — `createOrderChange`
 * (change_type `credit_line`), `addOrderAction` (`CREDIT_LINE_ADD`), then
 * `confirmOrderChange` — which is what `IOrderModuleService.confirmOrderChange`
 * actually turns into the persisted `order_credit_line` row, versioned and
 * tied to an auditable `OrderChange`/`OrderChangeAction` history. Calling
 * `IOrderModuleService.createOrderCreditLines` directly (the generated
 * low-level CRUD method) skips all of that: no order-change action, no
 * order version bump, no accounting history — so `issueThamaniStoreCredit`
 * (`src/workflows/thamani-store-credit-issuance.ts`) goes through the
 * order-change path instead. See `issueThamaniStoreCreditWorkflow` for the
 * actual issuance workflow that wires this into the running application.
 *
 * `CREDIT_LINE_ADD`'s own handler (`@medusajs/order`) only ever copies
 * `amount`, `reference`, and `reference_id` from the order-change action
 * onto the resulting credit line — no `metadata` field is read from the
 * action at all, so the reason and its trace-back travel in those two
 * fields (matching what they're documented for) rather than in metadata. A
 * SERVICE credit's justification, which has no `reference_id` to attach to,
 * is instead recorded as the owning `OrderChange`'s own `internal_note`.
 */

export type ThamaniStoreCreditReason = "REFUND" | "SERVICE" | "PROMOTIONAL"

/**
 * Each reason has a distinct ERP accounting consequence: a REFUND-reason
 * credit reduces revenue/accounts-receivable for a specific returned or
 * cancelled order, a SERVICE-reason credit is a goodwill adjustment booked
 * as a customer-service cost (never a revenue reversal), and a
 * PROMOTIONAL-reason credit is a marketing-driven adjustment booked as a
 * marketing expense (also never a revenue reversal). Getting this wrong
 * mis-states the ERP's revenue and expense lines, so it is derived here from
 * the reason rather than left to each caller to set by hand.
 */
export const THAMANI_STORE_CREDIT_REASON_CONFIG: Record<
  ThamaniStoreCreditReason,
  {
    /** `reference` on the native Order Credit Line — a model-name-shaped tag, not free text. */
    reference: string
    /** ERP financial treatment this reason's credit lines are booked under. */
    erpFinancialConsequence: "AR_CREDIT_MEMO" | "CUSTOMER_SERVICE_EXPENSE" | "MARKETING_EXPENSE"
    /**
     * Whether this reason requires a `referenceId` tracing the credit back to
     * its source: a REFUND must trace to the return/cancellation it offsets,
     * and a PROMOTIONAL credit must trace to the approved campaign/policy
     * that authorised it — an unaccountable promotional credit is exactly
     * the kind of thing a real finance team needs to be able to trace back.
     * SERVICE credits are goodwill judgement calls with no such prior
     * record; a human-readable justification is required in its place (see
     * `buildThamaniStoreCreditOrderChangeInput`).
     */
    requiresReferenceId: boolean
  }
> = {
  REFUND: {
    reference: "thamani_store_credit_refund",
    erpFinancialConsequence: "AR_CREDIT_MEMO",
    requiresReferenceId: true,
  },
  SERVICE: {
    reference: "thamani_store_credit_service",
    erpFinancialConsequence: "CUSTOMER_SERVICE_EXPENSE",
    requiresReferenceId: false,
  },
  PROMOTIONAL: {
    reference: "thamani_store_credit_promotional",
    erpFinancialConsequence: "MARKETING_EXPENSE",
    requiresReferenceId: true,
  },
}

export type ThamaniStoreCreditIssuanceInput = {
  orderId: string
  amountMinor: number
  reason: ThamaniStoreCreditReason
  /** Required for REFUND (the return/cancellation) and PROMOTIONAL (the campaign/policy). */
  referenceId?: string | null
  /** Required for SERVICE in place of a referenceId — a human-readable reason a credit was granted. */
  serviceJustification?: string | null
  createdBy?: string
}

/** The order-change/action fields `issueThamaniStoreCreditWorkflow` needs to issue this credit. */
export type ThamaniStoreCreditOrderChangeInput = {
  orderId: string
  amountMinor: number
  reference: string
  referenceId: string | null
  internalNote: string | null
  createdBy?: string
}

export const buildThamaniStoreCreditOrderChangeInput = (
  input: ThamaniStoreCreditIssuanceInput,
): ThamaniStoreCreditOrderChangeInput => {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new Error("Store credit amount must be a positive integer in minor units")
  const config = THAMANI_STORE_CREDIT_REASON_CONFIG[input.reason]
  if (config.requiresReferenceId && !input.referenceId)
    throw new Error(
      `Store credit reason ${input.reason} requires a referenceId tracing it to its source`,
    )
  if (input.reason === "SERVICE" && !input.referenceId && !input.serviceJustification)
    throw new Error("A SERVICE store credit requires a serviceJustification or a referenceId")
  return {
    orderId: input.orderId,
    amountMinor: input.amountMinor,
    reference: config.reference,
    referenceId: input.referenceId ?? null,
    internalNote: input.serviceJustification ?? null,
    createdBy: input.createdBy,
  }
}
