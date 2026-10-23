import { buyerAuthorityReceiptSchema } from "../contracts/authority-validation"
import type { PgPool } from "../orders/postgres-governed-binding-persistence"

/**
 * ADR-SHARED-042 sections 9 and 12, Decision 6 (Shared trade/v2
 * buyer-authority-receipt; ADR-0037): Trade records the server-built
 * BuyerAuthorityReceipt when the buyer operation decision is ALLOW for one
 * consequential operation. Only Trade builds one, from a
 * TradeBuyerExecutionContext; no browser, client, Medusa customer token,
 * webhook or job may submit, mint or extend one.
 *
 * Recording is not consumption. The native commit fence
 * (Migration20261023150000) consumes it once, with the seller receipt for the
 * same operation reference, in the order's own transaction, and converts the
 * spend reservation it names to committed consumption there. The database
 * refuses a receipt that is not current, outlives 60 seconds, or names a
 * reservation that does not hold exactly its purchase, amount and hold
 * revision.
 */

/** The wire BuyerAuthorityReceipt (trade/v2). */
export type BuyerAuthorityReceipt = {
  receipt_id: string
  context_id: string
  decision_id: string
  correlation_id: string
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
  valuation_digest: string
  currency: string
  policy_revision: string
  approval_references?: string[]
  spend_reservation_id: string
  spend_hold_revision: number
  seller_legal_entity_id: string
  seller_binding_reference: { binding_id: string; binding_version: number }
  evaluated_at: string
  expires_at: string
  evidence_references?: string[]
}

export class BuyerAuthorityReceiptRefused extends Error {
  constructor(readonly reason: "CONTRACT_INVALID" | "NOT_RECORDED") {
    super(`buyer-authority receipt not recorded: ${reason}`)
    this.name = "BuyerAuthorityReceiptRefused"
  }
}

export class PostgresBuyerAuthorityReceiptStore {
  constructor(private readonly pool: PgPool) {}

  /** Record one receipt exactly as built. Nothing is ever updated. */
  async record(receipt: BuyerAuthorityReceipt): Promise<void> {
    if (!buyerAuthorityReceiptSchema(receipt))
      throw new BuyerAuthorityReceiptRefused("CONTRACT_INVALID")
    const db = await this.pool.connect()
    try {
      await db.query(
        `INSERT INTO trade_buyer_authority_receipt (receipt_id, context_id, decision_id, correlation_id, operation,
           operation_reference, actor_principal_id, tenant_id, canonical_organisation_id, buyer_organisation_id,
           buyer_membership_id, membership_revision, market_id, resource_id, resource_version, transaction_digest,
           amount_minor, currency, valuation_digest, policy_revision, approval_references, spend_reservation_id,
           spend_hold_revision, seller_legal_entity_id, seller_binding_id, seller_binding_version, evaluated_at,
           expires_at, evidence_references, receipt)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                 $18, $19, $20, $21, $22, $23, $24, $25::uuid, $26, $27, $28, $29, $30)`,
        [
          receipt.receipt_id,
          receipt.context_id,
          receipt.decision_id,
          receipt.correlation_id,
          receipt.operation,
          receipt.operation_reference,
          receipt.actor_principal_id,
          receipt.tenant_id,
          receipt.canonical_organisation_id,
          receipt.buyer_organisation_id,
          receipt.buyer_membership_id,
          receipt.membership_revision,
          receipt.market_id,
          receipt.resource_id,
          receipt.resource_version,
          receipt.transaction_digest,
          receipt.amount_minor,
          receipt.currency,
          receipt.valuation_digest,
          receipt.policy_revision,
          receipt.approval_references ?? [],
          receipt.spend_reservation_id,
          receipt.spend_hold_revision,
          receipt.seller_legal_entity_id,
          receipt.seller_binding_reference.binding_id,
          receipt.seller_binding_reference.binding_version,
          receipt.evaluated_at,
          receipt.expires_at,
          receipt.evidence_references ?? [],
          JSON.stringify(receipt),
        ],
      )
    } catch {
      throw new BuyerAuthorityReceiptRefused("NOT_RECORDED")
    } finally {
      db.release()
    }
  }
}
