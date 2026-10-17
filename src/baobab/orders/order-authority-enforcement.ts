/**
 * ADR-SHARED-039 Trade-A TA-05: the central order-authority enforcement point.
 *
 * For one catalogued Trade-A operation on one native record, Trade:
 *   1. attributes the record to exactly one CP binding version (TA-04);
 *   2. obtains a fresh CP order-authority decision for that exact version,
 *      operation class and operation reference (TA-03 client);
 *   3. refuses anything but a current AUTHORIZED decision, honouring
 *      min(expires_at, receipt + 30 s);
 *   4. records an append-only receipt binding the decision id, mandate and
 *      legal entity to the attribution and operation.
 * Only the receipt's consumption at the persistence commit point (TA-07)
 * completes an operation; TA-06 wires this PEP into every entry point.
 *
 * Protected runtimes stay closed: production or an unknown profile is always
 * denied, and a non-production run needs explicit enablement. Activation is
 * never this flag; it is TA-07/TA-08 evidence.
 */
import type {
  OrderAuthorityDecision,
  TradeAOperationClass,
  TradeOrderAuthorityPort,
} from "../control-plane/trade-order-authority"
import { isCurrentOrderAuthority } from "../control-plane/trade-order-authority"
import {
  attributeCommitment,
  CommitmentAttributionDenied,
  type CommitmentAttributionDependencies,
  type CommitmentSubject,
  type CommitmentSubjectType,
} from "./commitment-attribution"
import type { NativeCommitmentScope } from "./native-configuration-resolver"
import { resolveNativeCheckoutEnvironment } from "./native-cart-legal-seller"
import type { PgPool } from "./postgres-governed-binding-persistence"

/** Which native record each Trade-A class may commit. */
const CLASS_SUBJECTS: Record<TradeAOperationClass, CommitmentSubjectType> = {
  "trade.order.commit": "cart",
  "trade.order.create": "order",
  "trade.draft-order.finalize": "draft_order",
}

export type OrderAuthorityReceipt = {
  receipt_id: string
  attribution_id: string
  operation_class: TradeAOperationClass
  operation_reference: string
  decision_id: string
  binding_id: string
  binding_version: number
  native_configuration_digest: string
  currency: string
  context_id: string
  tenant_id: string
  operating_organisation_id: string
  market: string
  mandate_id: string
  responsible_legal_entity_id: string
  policy_reference: string
  evaluated_at: string
  received_at: string
  lease_expires_at: string
}

export interface OrderAuthorityReceiptStore {
  record(receipt: Omit<OrderAuthorityReceipt, "receipt_id">): Promise<OrderAuthorityReceipt>
}

export type OrderAuthorityEnforcementDependencies = CommitmentAttributionDependencies & {
  authority: Pick<TradeOrderAuthorityPort, "resolveBinding" | "resolveOrderAuthority">
  receipts: OrderAuthorityReceiptStore
  environment: { node?: string; baobab?: string; deployment?: string; enabled?: string }
}

/** RFC 9457 mapping per ADR-SHARED-039 §6. */
export type TradeAuthorityProblem = { status: 401 | 403 | 409 | 503; code: string; detail: string }

export class OrderAuthorityDenied extends Error {
  constructor(
    readonly outcome: string,
    readonly problem: TradeAuthorityProblem,
  ) {
    super(`Trade-A order authority denied (${outcome}): ${problem.detail}`)
  }
}

const UNAVAILABLE = new Set(["UNAVAILABLE", "CP_UNAVAILABLE"])
const NOT_AUTHORISED = new Set([
  "OPERATION_NOT_ACTIVATED",
  "PROTECTED_RUNTIME",
  "UNCATALOGUED_OPERATION",
])

export function tradeAuthorityProblem(outcome: string): TradeAuthorityProblem {
  if (UNAVAILABLE.has(outcome))
    return {
      status: 503,
      code: "TRADE_AUTHORITY_UNAVAILABLE",
      detail: "order authority or its durable receipt is temporarily unavailable",
    }
  if (NOT_AUTHORISED.has(outcome))
    return {
      status: 403,
      code: "TRADE_OPERATION_NOT_AUTHORISED",
      detail: "operation is not catalogued, activated or permitted here",
    }
  if (outcome === "INVALID_LIFECYCLE_STATE")
    return {
      status: 409,
      code: "TRADE_INVALID_LIFECYCLE_STATE",
      detail: "operation is invalid in the record's current state",
    }
  // Missing, inactive or mismatched binding, mandate or context: forbidden, never a fallback.
  return {
    status: 403,
    code: `TRADE_${outcome}`,
    detail: "no current seller binding and mandate authorise this operation",
  }
}

const deny = (outcome: string): never => {
  throw new OrderAuthorityDenied(outcome, tradeAuthorityProblem(outcome))
}

const REFERENCE = /^[\x21-\x7E]{1,256}$/

export async function enforceOrderAuthority(
  operationClass: TradeAOperationClass,
  subject: CommitmentSubject,
  native: NativeCommitmentScope,
  operationReference: string,
  deps: OrderAuthorityEnforcementDependencies,
): Promise<OrderAuthorityReceipt> {
  const profile = resolveNativeCheckoutEnvironment(deps?.environment ?? {})
  if (profile.production || deps?.environment?.enabled !== "true") deny("PROTECTED_RUNTIME")
  if (!(operationClass in CLASS_SUBJECTS)) deny("UNCATALOGUED_OPERATION")
  if (subject?.type !== CLASS_SUBJECTS[operationClass]) deny("UNCATALOGUED_OPERATION")
  if (!REFERENCE.test(operationReference ?? "")) deny("INVALID_OPERATION_REFERENCE")
  if (!deps.receipts) deny("UNAVAILABLE")
  const now = deps.now ?? Date.now

  let attributed: Awaited<ReturnType<typeof attributeCommitment>>
  try {
    attributed = await attributeCommitment(subject, native, deps)
  } catch (error) {
    return deny(error instanceof CommitmentAttributionDenied ? error.outcome : "UNAVAILABLE")
  }
  const { attribution } = attributed
  if (!(attributed.context.expiresAt > now())) deny("CONTEXT_NOT_USABLE")

  let decision: OrderAuthorityDecision
  let receivedAt: number
  try {
    ;({ decision, receivedAt } = await deps.authority.resolveOrderAuthority(
      {
        context_id: attribution.context_id,
        engine_instance_id: attribution.engine_instance_id,
        operation_class: operationClass,
        seller_operating_binding_reference: {
          binding_id: attribution.binding_id,
          binding_version: attribution.binding_version,
        },
        native_configuration_digest: attribution.native_configuration_digest,
        currency: attribution.currency,
        operation_reference: operationReference,
      },
      await deps.tokens.getAccessToken(),
      `trade-order-authority/${attribution.attribution_id}`,
    ))
  } catch {
    return deny("UNAVAILABLE")
  }
  if (decision.outcome !== "AUTHORIZED") deny(decision.outcome)
  if (
    !isCurrentOrderAuthority(decision, receivedAt, now()) ||
    decision.tenant_id !== attribution.tenant_id ||
    decision.operating_organisation_id !== attribution.operating_organisation_id ||
    decision.market !== attribution.market ||
    decision.legal_actor_role !== "SELLER_OF_RECORD"
  ) {
    deny("REVOKED_OR_EXPIRED")
  }
  const {
    mandate_id: mandateId,
    responsible_legal_entity_id: legalEntityId,
    expires_at: expiresAt,
  } = decision
  // isCurrentOrderAuthority already required these; the guard keeps the types honest.
  if (!mandateId || !legalEntityId || !expiresAt) return deny("ACTOR_NOT_VERIFIED")
  const lease = Math.min(Date.parse(expiresAt), receivedAt + 30_000)
  try {
    // Authority is unusable until its durable receipt exists. Await inside
    // this boundary: returning the promise would let an asynchronous insert
    // rejection escape the RFC 9457 denial mapping. Do not expose SQL errors,
    // credentials or constraint details, and do not retry an old CP decision.
    return await deps.receipts.record({
      attribution_id: attribution.attribution_id,
      operation_class: operationClass,
      operation_reference: operationReference,
      decision_id: decision.decision_id,
      binding_id: attribution.binding_id,
      binding_version: attribution.binding_version,
      native_configuration_digest: attribution.native_configuration_digest,
      currency: attribution.currency,
      context_id: attribution.context_id,
      tenant_id: attribution.tenant_id,
      operating_organisation_id: attribution.operating_organisation_id,
      market: attribution.market,
      mandate_id: mandateId,
      responsible_legal_entity_id: legalEntityId,
      policy_reference: decision.policy_reference,
      evaluated_at: decision.evaluated_at,
      received_at: new Date(receivedAt).toISOString(),
      lease_expires_at: new Date(lease).toISOString(),
    })
  } catch {
    return deny("UNAVAILABLE")
  }
}

const COLUMNS = `receipt_id::text, attribution_id::text, operation_class, operation_reference, decision_id::text,
  binding_id::text, binding_version, native_configuration_digest, currency, context_id::text, tenant_id,
  operating_organisation_id::text, market, mandate_id::text, responsible_legal_entity_id, policy_reference,
  evaluated_at, received_at, lease_expires_at`

export class PostgresOrderAuthorityReceiptStore implements OrderAuthorityReceiptStore {
  constructor(private readonly pool: PgPool) {}

  async record(r: Omit<OrderAuthorityReceipt, "receipt_id">): Promise<OrderAuthorityReceipt> {
    const db = await this.pool.connect()
    try {
      const result = await db.query(
        `INSERT INTO trade_order_authority_receipt (
           attribution_id, operation_class, operation_reference, decision_id, binding_id, binding_version,
           native_configuration_digest, currency, context_id, tenant_id, operating_organisation_id, market,
           mandate_id, responsible_legal_entity_id, policy_reference, evaluated_at, received_at, lease_expires_at)
         VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6, $7, $8, $9::uuid, $10, $11::uuid, $12, $13::uuid,
                 $14, $15, $16, $17, $18)
         RETURNING ${COLUMNS}`,
        [
          r.attribution_id,
          r.operation_class,
          r.operation_reference,
          r.decision_id,
          r.binding_id,
          r.binding_version,
          r.native_configuration_digest,
          r.currency,
          r.context_id,
          r.tenant_id,
          r.operating_organisation_id,
          r.market,
          r.mandate_id,
          r.responsible_legal_entity_id,
          r.policy_reference,
          r.evaluated_at,
          r.received_at,
          r.lease_expires_at,
        ],
      )
      if (result.rowCount !== 1) throw new Error("Order-authority receipt was not recorded")
      const row = result.rows[0]
      const iso = (v: unknown) => new Date(v as string).toISOString()
      return {
        ...(row as unknown as OrderAuthorityReceipt),
        binding_version: Number(row.binding_version),
        evaluated_at: iso(row.evaluated_at),
        received_at: iso(row.received_at),
        lease_expires_at: iso(row.lease_expires_at),
      }
    } finally {
      db.release()
    }
  }
}
