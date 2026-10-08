export type LedgerEvidence = {
  evidenceId: string
  evidenceType: "ORDER_ACCEPTED" | "PAYMENT_OBSERVED" | "REFUND_OBSERVED" | "FULFILMENT_OBSERVED"
  canonicalEntityId: string
  commerceReference: string
  amountMinor?: number
  currencyCode?: string
  occurredAt: string
  idempotencyKey: string
  correlationId: string
  causationId?: string
  evidence: Record<string, unknown>
}
export interface LedgerEvidencePort {
  append(evidence: LedgerEvidence): Promise<{ evidenceId: string; accepted: boolean }>
}
/** Boundary only: this does not create a ledger or assign financial authority to Trade. */
export class DisabledLedgerEvidenceAdapter implements LedgerEvidencePort {
  async append(evidence: LedgerEvidence) {
    if (evidence.amountMinor !== undefined && !evidence.currencyCode)
      throw new Error("Monetary ledger evidence requires currency")
    return { evidenceId: evidence.evidenceId, accepted: false }
  }
}
