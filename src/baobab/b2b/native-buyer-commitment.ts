import { randomUUID } from "node:crypto"
import {
  buyerAuthorityReceiptSchema,
  buyerExecutionContextSchema,
  erpOrderConsequenceSchema,
} from "../contracts/authority-validation"
import { createTenantTradeEvent, isValidCloudEvent } from "../events/event-contracts"
import { canonicalEventFingerprint } from "../events/outbox"
import { withTradeOutboxSpan } from "../observability/tracing"
import type { BaobabTenantContext } from "../contracts/tenant-context"
import type { PgClient } from "../orders/postgres-governed-binding-persistence"
import type { OrderAuthorityReceipt } from "../orders/order-authority-enforcement"
import type { TradeBuyerExecutionContext } from "./buyer-authority"
import {
  buildFinalBuyerCommitmentValuation,
  type BuyerCommitmentValuation,
  type FinalNativeValuationFacts,
} from "./buyer-commitment-valuation"
import type { CommitCommand, SpendCommandResult } from "./spend-reservation-commands"

/**
 * CAA-06b / DEV-07. A *non-routed* composition seam for a trusted native
 * Medusa order owner. No browser payload, background worker or stand-alone
 * event publisher may provide the authority snapshot or call this as checkout.
 *
 * The owner must write native Medusa order records with the SAME PgClient
 * that owns the spend ledger COMMIT. Medusa workflows that open their own
 * transaction cannot be passed in as owner.writeOrder: they are NOT atomic.
 * Until an actual native Medusa owner adapter is proven, this remains inert.
 *
 * The owning PG triggers, not this TypeScript alone, consume the seller receipt
 * and verify the order/event/spend share one PostgreSQL XID.
 */
export type BuyerReceipt = {
  receipt_id: string
  context_id: string
  decision_id: string
  operation: "trade.order.commit" | "trade.order.create" | "trade.draft-order.finalize"
  operation_reference: string
  actor_principal_id: string
  tenant_id: string
  canonical_organisation_id: string
  buyer_organisation_id: string
  buyer_membership_id: string
  membership_revision: number
  market_id: string
  resource_id: string
  resource_version: number
  transaction_digest: string
  amount_minor: number
  currency: string
  valuation_digest: string
  policy_revision: string
  spend_reservation_id: string
  spend_hold_revision: number
  seller_legal_entity_id: string
  seller_binding_reference: { binding_id: string; binding_version: number }
  evaluated_at: string
  expires_at: string
  [key: string]: unknown
}

export type AuthorizedCommitment = {
  context: TradeBuyerExecutionContext
  /** A second, current permission decision for this CONSEQUENTIAL operation;
   * buyer-context.resolve ALLOW is only discovery and is never enough. */
  operationDecision: {
    outcome: "ALLOW"
    decisionId: string
    operation: BuyerReceipt["operation"]
    principalId: string
    transactionDigest: string
    amountMinor: number
    resourceVersion: number
    evaluatedAt: string
    expiresAt: string
  }
  /** Made server-side only after a fresh Trade operation ALLOW and IAM/CP readback. */
  receipt: BuyerReceipt
  /** The same seller PEP decision and durable receipt, not a client assertion. */
  seller: OrderAuthorityReceipt
  /** The valuation against which approval and current budget hold were issued. */
  valuation: BuyerCommitmentValuation
}

export type NativeErpOrderConsequence = {
  legal_entity_id: string
  commerce_order_id: string
  order_version: number
  customer_id: string
  placed_at: string
  currency: string
  lines: Array<{
    line_id: string
    sku_id: string
    quantity: { value: string; unit: string }
    unit_price: { amount: string; currency: string }
    line_total: { amount: string; currency: string }
  }>
  totals: {
    subtotal: { amount: string; currency: string }
    discount: { amount: string; currency: string }
    quoted_tax: { amount: string; currency: string }
    grand_total: { amount: string; currency: string }
  }
  [key: string]: unknown
}

type Query = Pick<PgClient, "query">

export type NativeMedusaTransactionOwner = {
  /** MUST use this connection, not container.resolve(Modules.ORDER) on another transaction. */
  writeOrder(db: Query, orderId: string): Promise<void>
  /** Re-read genuine persisted Medusa native pricing/fulfilment facts at COMMIT. */
  readFinalValuation(db: Query, orderId: string): Promise<FinalNativeValuationFacts>
  /** Build ERP consequence from persisted native Medusa order + line records. */
  readErpConsequence(db: Query, orderId: string): Promise<NativeErpOrderConsequence>
  /** Trusted, persisted native currency precision for this *same* order.
   * Never infer fractional digits from a browser currency string or float. */
  readCurrencyExponent(db: Query, orderId: string): Promise<number>
}

export type NativeCommitDependencies = {
  /** Server-side authoritative IAM/CP/Trade policy resolution, never request data. */
  authorizeNow(): Promise<AuthorizedCommitment>
  spend: {
    commitWithMutation(
      command: CommitCommand,
      mutation: (db: Query) => Promise<void>,
    ): Promise<SpendCommandResult>
  }
  native: NativeMedusaTransactionOwner
  now?: () => number
  newEventId?: () => string
}

export type NativeCommitRequest = {
  /** Preallocated by a trusted native Medusa order owner; never supplied by the browser. */
  nativeOrderId: string
  /** The owning transaction's idempotency key, generated by the server. */
  idempotencyKey: string
  correlationId: string
  /** The owner-proven canonical tenant context, not a browser-selected tenant. */
  tenant: BaobabTenantContext
}

export type NativeCommitOutcome =
  | { outcome: "COMMITTED"; orderId: string; eventId: string }
  | { outcome: "REPLAYED"; orderId: string; eventId: null }
  | { outcome: "REFUSED"; reason: string }

const SHA = /^sha256:[0-9a-f]{64}$/
const NATIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,199}$/
const idempotency = /^[A-Za-z0-9._:-]{16,128}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Exact decimal conversion, without Number/parseFloat arithmetic.
 * More fractional digits than the native currency uses are acceptable ONLY
 * if all excess digits are zero. A missing native exponent is never guessed.
 */
function exactMoneyMinor(amount: string, exponent: number): bigint | null {
  if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > 9) return null
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount)) return null
  const [units, fractional = ""] = amount.split(".")
  if (fractional.length > exponent && /[1-9]/.test(fractional.slice(exponent))) return null
  const negative = units.startsWith("-")
  const whole = negative ? units.slice(1) : units
  const decimal = fractional.slice(0, exponent).padEnd(exponent, "0")
  const minor = BigInt(whole) * 10n ** BigInt(exponent) + BigInt(decimal || "0")
  return negative ? -minor : minor
}

function requireCommitment(
  p: AuthorizedCommitment,
  request: NativeCommitRequest,
  now: number,
): { receipt: BuyerReceipt; seller: OrderAuthorityReceipt; valuation: BuyerCommitmentValuation } {
  const { receipt: b, seller: s, context: c, valuation: v, operationDecision: d } = p
  // Schema conformance cannot replace a live authorisation readback, but
  // an unregistered or stale receipt must never reach native persistence.
  if (!buyerAuthorityReceiptSchema(b)) throw new Error("BUYER_RECEIPT_NOT_CANONICAL")
  // Shared requires the consequential context to bind the full purchase
  // and seller. A schema-valid receipt cannot repair an incomplete context.
  if (!buyerExecutionContextSchema(c)) throw new Error("BUYER_CONTEXT_NOT_CANONICAL")
  if (
    !c ||
    c.decision.outcome !== "ALLOW" ||
    !d ||
    d.outcome !== "ALLOW" ||
    d.decisionId !== b.decision_id ||
    d.operation !== b.operation ||
    d.principalId !== b.actor_principal_id ||
    d.transactionDigest !== b.transaction_digest ||
    d.amountMinor !== b.amount_minor ||
    d.resourceVersion !== b.resource_version ||
    !(Date.parse(d.evaluatedAt) <= now && now < Date.parse(d.expiresAt)) ||
    !UUID.test(request.correlationId) ||
    b.correlation_id !== request.correlationId ||
    c.correlation_id !== request.correlationId ||
    !NATIVE_ID.test(request.nativeOrderId) ||
    !idempotency.test(request.idempotencyKey) ||
    !Number.isFinite(now) ||
    !(Date.parse(b.evaluated_at) <= now && now < Date.parse(b.expires_at)) ||
    Date.parse(b.expires_at) - Date.parse(b.evaluated_at) > 60_000 ||
    !(Date.parse(c.evaluated_at) <= now) ||
    Date.parse(c.expires_at) - Date.parse(c.evaluated_at) > 60_000 ||
    !(now < Date.parse(c.expires_at)) ||
    !(now < Date.parse(s.lease_expires_at)) ||
    b.context_id !== c.context_id ||
    c.operation !== b.operation ||
    c.decision_id !== b.decision_id ||
    c.policy_revision !== b.policy_revision ||
    b.resource_id !== c.resource_id ||
    b.resource_version !== c.resource_version ||
    b.transaction_digest !== c.transaction_digest ||
    b.amount_minor !== c.amount_minor ||
    b.currency !== c.currency ||
    b.valuation_digest !== c.valuation_digest ||
    b.seller_legal_entity_id !== c.seller_legal_entity_id ||
    b.seller_binding_reference.binding_id !== c.seller_binding_reference?.binding_id ||
    b.seller_binding_reference.binding_version !== c.seller_binding_reference?.binding_version ||
    (c.market_id !== undefined && c.market_id !== b.market_id) ||
    request.tenant.lifecycleStatus !== "active" ||
    request.tenant.entitled !== true ||
    request.tenant.productId !== "baobab-trade" ||
    b.actor_principal_id !== c.actor_principal_id ||
    b.tenant_id !== c.tenant_id ||
    b.tenant_id !== request.tenant.tenantId ||
    b.canonical_organisation_id !== c.canonical_organisation_id ||
    b.buyer_organisation_id !== c.buyer_organisation_id ||
    b.buyer_membership_id !== c.buyer_membership_id ||
    b.membership_revision !== c.membership_revision ||
    b.seller_binding_reference.binding_id !== s.binding_id ||
    b.seller_binding_reference.binding_version !== s.binding_version ||
    b.seller_legal_entity_id !== s.responsible_legal_entity_id ||
    b.operation !== s.operation_class ||
    b.operation_reference !== s.operation_reference ||
    b.tenant_id !== s.tenant_id ||
    b.currency !== s.currency ||
    b.resource_id !== v.resource_id ||
    b.resource_version !== v.resource_version ||
    b.transaction_digest !== v.transaction_digest ||
    b.currency !== v.currency ||
    b.valuation_digest !== v.valuation_digest ||
    b.amount_minor !== v.buyer_commitment_amount_minor ||
    !SHA.test(v.valuation_digest)
  )
    throw new Error("BUYER_COMMITMENT_CHANGED_OR_UNAUTHORISED")
  return { receipt: b, seller: s, valuation: v }
}

/**
 * On any failure the existing spend command rolls back its ledger conversion,
 * the native Medusa write, the two receipt inserts and the outbox insert.
 *
 * A replay never calls the native writer. The event ID is deliberately null on
 * replay until independently read back; inventing a new event would be unsafe.
 */
export async function commitAuthorizedNativeBuyerOrder(
  deps: NativeCommitDependencies,
  request: NativeCommitRequest,
): Promise<NativeCommitOutcome> {
  let p: AuthorizedCommitment
  let verified: ReturnType<typeof requireCommitment>
  try {
    // Must issue new decisions on every new attempt; no cached buyer authority.
    p = await deps.authorizeNow()
    verified = requireCommitment(p, request, (deps.now ?? Date.now)())
  } catch {
    return { outcome: "REFUSED", reason: "CURRENT_IAM_CP_BUYER_AUTHORITY_NOT_PROVEN" }
  }
  const { receipt: b, seller: s, valuation: expected } = verified
  if (
    !NATIVE_ID.test(request.nativeOrderId) ||
    b.spend_reservation_id.length < 8 ||
    !Number.isSafeInteger(b.spend_hold_revision) ||
    !UUID.test(b.receipt_id)
  )
    return { outcome: "REFUSED", reason: "NATIVE_COMMITMENT_INVALID" }

  const command: CommitCommand = {
    idempotencyKey: request.idempotencyKey,
    organisationId: b.buyer_organisation_id,
    reservationId: b.spend_reservation_id,
    actorPrincipalId: b.actor_principal_id,
    holdRevision: b.spend_hold_revision,
    transactionDigest: b.transaction_digest,
    resourceVersion: b.resource_version,
    amountMinor: BigInt(b.amount_minor),
    commitmentReference: request.nativeOrderId,
  }
  const eventId = (deps.newEventId ?? randomUUID)()
  if (!UUID.test(eventId)) return { outcome: "REFUSED", reason: "NATIVE_EVENT_ID_INVALID" }

  const result = await deps.spend.commitWithMutation(command, async (db) => {
    // Waiting for the reservation/policy locks may exhaust a shorter context
    // or operation lease even while the buyer receipt itself remains valid.
    requireCommitment(p, request, (deps.now ?? Date.now)())
    // The receipt insert, Medusa native write, outbox and its consumption are
    // deliberately performed in the *existing* spend COMMIT transaction.
    await db.query(
      "INSERT INTO trade_buyer_authority_receipt (receipt_id,payload,evaluated_at,expires_at) VALUES ($1::uuid,$2::jsonb,$3::timestamptz,$4::timestamptz)",
      [b.receipt_id, JSON.stringify(b), b.evaluated_at, b.expires_at],
    )
    await deps.native.writeOrder(db, request.nativeOrderId)
    const finalFacts = await deps.native.readFinalValuation(db, request.nativeOrderId)
    const final = buildFinalBuyerCommitmentValuation(finalFacts)
    if (
      final.valuation_digest !== expected.valuation_digest ||
      final.buyer_commitment_amount_minor !== b.amount_minor ||
      final.transaction_digest !== b.transaction_digest ||
      final.resource_version !== b.resource_version ||
      final.resource_id !== b.resource_id ||
      final.currency !== b.currency
    )
      throw new Error("NATIVE_FINAL_VALUATION_CHANGED")
    const data = await deps.native.readErpConsequence(db, request.nativeOrderId)
    const currencyExponent = await deps.native.readCurrencyExponent(db, request.nativeOrderId)
    // Native pricing and source readback are asynchronous. A pre-write ALLOW
    // must not survive its lease merely because those reads started in time.
    // Throw through the owning transaction; never renew the original proof.
    requireCommitment(p, request, (deps.now ?? Date.now)())
    // Fail closed on the complete pinned ERP v1 semantic envelope *before*
    // persisting the outbox. This is a shape check, not native-source proof;
    // the Medusa owner must still independently reread the genuine order.
    if (
      !erpOrderConsequenceSchema(data) ||
      data.commerce_order_id !== request.nativeOrderId ||
      data.legal_entity_id !== s.responsible_legal_entity_id ||
      data.currency !== b.currency ||
      !Number.isSafeInteger(data.order_version) ||
      data.order_version < 1 ||
      !data.customer_id ||
      !data.lines?.length ||
      !data.totals?.grand_total ||
      !Number.isSafeInteger(currencyExponent) ||
      currencyExponent < 0 ||
      currencyExponent > 9 ||
      exactMoneyMinor(data.totals.grand_total.amount, currencyExponent) !==
        BigInt(b.amount_minor) ||
      Object.values(data.totals).some((money) => money.currency !== b.currency) ||
      data.lines.some(
        (line) =>
          line.unit_price.currency !== b.currency || line.line_total.currency !== b.currency,
      )
    )
      throw new Error("NATIVE_ERP_BUSINESS_FACTS_NOT_VERIFIED")
    const event = await withTradeOutboxSpan(eventId, async () => {
    const original = createTenantTradeEvent(request.tenant, {
      id: eventId,
      type: "com.baobab-platform.trade.order.placed.v1",
      subject: "commerce-order/" + request.nativeOrderId,
      time: new Date().toISOString(),
      dataschema:
        "https://contracts.baobab-platform.com/erp/v1/commerce-order-consequence.schema.json",
      correlationid: request.correlationId,
      causationid: b.receipt_id,
      idempotencykey: request.idempotencyKey,
      data,
    })
    if (!isValidCloudEvent(original)) throw new Error("NATIVE_EVENT_INVALID")
    // Direct SQL is essential here. EventOutboxRecordAdapter uses a separate
    // Medusa module transaction and cannot prove atomicity with this order.
    await db.query(
      `INSERT INTO event_outbox (id,event_id,event_type,subject,tenant_id,owner_legal_entity_id,
         correlation_id,causation_id,idempotency_key,envelope_digest,envelope,status,attempt_count,next_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'PENDING',0,clock_timestamp())`,
      [
        "evtout_" + randomUUID().replaceAll("-", ""),
        original.id,
        original.type,
        original.subject,
        b.tenant_id,
        s.responsible_legal_entity_id,
        original.correlationid,
        original.causationid,
        original.idempotencykey,
        canonicalEventFingerprint(original),
        JSON.stringify(original),
      ],
    )
    return original
    })
    // SQL guard verifies current membership, matching seller receipt,
    // committed spend ledger, actual native order and event all share this XID.
    await db.query(
      `INSERT INTO trade_buyer_authority_consumption
        (receipt_id,seller_receipt_id,spend_reservation_id,operation_reference,order_id,event_id)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6)`,
      [
        b.receipt_id,
        s.receipt_id,
        b.spend_reservation_id,
        b.operation_reference,
        request.nativeOrderId,
        event.id,
      ],
    )
  })
  if (result.outcome === "APPLIED")
    return { outcome: "COMMITTED", orderId: request.nativeOrderId, eventId }
  if (result.outcome === "REPLAYED")
    return { outcome: "REPLAYED", orderId: request.nativeOrderId, eventId: null }
  return {
    outcome: "REFUSED",
    reason:
      result.outcome === "CONFLICT"
        ? "IDEMPOTENCY_CONFLICT"
        : result.outcome === "REFUSED"
          ? result.reason
          : "UNEXPECTED_SPEND_RESULT",
  }
}
