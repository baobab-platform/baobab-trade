/**
 * ADR-0019 §§31–35, 93–104, 122: Trade supplier award is NOT an ERP PO.
 * This consumer validates ERP-owned PO evidence without mutating ERP state.
 */
export type ApprovedSupplierAward = Readonly<{
  tenantId: string
  procurementCommitmentId: string
  approvedAwardId: string
  approvedSupplierCanonicalId: string
  supplierLegalEntityId: string
  supplierRegistrationReference: string
  buyerLegalEntityId: string
  marketId: string
  marketRevision: number
  currency: string
  totalMinor: number
  idempotencyKey: string
  status: "APPROVED"
}>

export type ErpPurchaseOrderEvidence = Readonly<{
  source: "ERP"
  sourceEventId: string
  procurementCommitmentId: string
  approvedAwardId: string
  tenantId: string
  supplierCanonicalId: string
  supplierLegalEntityId: string
  supplierRegistrationReference: string
  buyerLegalEntityId: string
  marketId: string
  marketRevision: number
  currency: string
  committedTotalMinor: number
  idempotencyKey: string
  erpPurchaseOrderId?: string
  status: "CREATED" | "APPROVED" | "REJECTED" | "UNKNOWN"
}>

export type PurchaseOrderProjection = Readonly<{
  procurementCommitmentId: string
  erpPurchaseOrderId: string | null
  status: "ERP_PENDING" | "ERP_CONFIRMED" | "ERP_RECONCILIATION_REQUIRED"
  evidenceEventId: string | null
}>

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/
const identifier = (value: unknown): value is string =>
  typeof value === "string" && IDENTIFIER.test(value)

/**
 * A success-looking ERP reply cannot become supplier-facing PO confirmation
 * if its legal buyer, supplier, Market, award, amount or command identity differs.
 * An unknown outcome must be reconciled, not blindly replayed.
 */
export function reconcileSupplierAwardToErp(
  award: ApprovedSupplierAward,
  evidence: ErpPurchaseOrderEvidence | null,
  prior?: PurchaseOrderProjection | null,
): PurchaseOrderProjection {
  const fields = [
    award.tenantId,
    award.procurementCommitmentId,
    award.approvedAwardId,
    award.approvedSupplierCanonicalId,
    award.supplierLegalEntityId,
    award.supplierRegistrationReference,
    award.buyerLegalEntityId,
    award.marketId,
    award.idempotencyKey,
  ]
  if (
    award.status !== "APPROVED" ||
    fields.some((field) => !identifier(field)) ||
    !Number.isSafeInteger(award.marketRevision) ||
    award.marketRevision < 1 ||
    !/^[A-Z]{3}$/.test(award.currency) ||
    !Number.isSafeInteger(award.totalMinor) ||
    award.totalMinor < 0
  ) {
    throw new Error("Procurement award is not a valid, authorised commercial commitment")
  }
  if (prior) {
    if (
      prior.procurementCommitmentId !== award.procurementCommitmentId ||
      !["ERP_PENDING", "ERP_CONFIRMED", "ERP_RECONCILIATION_REQUIRED"].includes(prior.status) ||
      (prior.erpPurchaseOrderId !== null && !identifier(prior.erpPurchaseOrderId)) ||
      (prior.evidenceEventId !== null && !identifier(prior.evidenceEventId)) ||
      (prior.status === "ERP_PENDING" &&
        (prior.erpPurchaseOrderId !== null || prior.evidenceEventId !== null)) ||
      (prior.status === "ERP_CONFIRMED" &&
        (!identifier(prior.erpPurchaseOrderId) || !identifier(prior.evidenceEventId)))
    ) {
      throw new Error("Procurement projection is invalid or belongs to a different commitment")
    }
  }
  if (evidence === null) {
    if (prior?.status === "ERP_CONFIRMED" || prior?.status === "ERP_RECONCILIATION_REQUIRED") {
      return prior
    }
    return {
      procurementCommitmentId: award.procurementCommitmentId,
      erpPurchaseOrderId: null,
      status: "ERP_PENDING",
      evidenceEventId: null,
    }
  }
  if (
    evidence.source !== "ERP" ||
    evidence.tenantId !== award.tenantId ||
    evidence.procurementCommitmentId !== award.procurementCommitmentId ||
    evidence.approvedAwardId !== award.approvedAwardId ||
    evidence.supplierCanonicalId !== award.approvedSupplierCanonicalId ||
    evidence.supplierLegalEntityId !== award.supplierLegalEntityId ||
    evidence.supplierRegistrationReference !== award.supplierRegistrationReference ||
    evidence.buyerLegalEntityId !== award.buyerLegalEntityId ||
    evidence.marketId !== award.marketId ||
    evidence.marketRevision !== award.marketRevision ||
    evidence.currency !== award.currency ||
    evidence.committedTotalMinor !== award.totalMinor ||
    evidence.idempotencyKey !== award.idempotencyKey ||
    !identifier(evidence.sourceEventId) ||
    !["CREATED", "APPROVED", "REJECTED", "UNKNOWN"].includes(evidence.status)
  ) {
    throw new Error("ERP PO evidence does not match the approved procurement commitment")
  }
  if (evidence.status === "REJECTED" || evidence.status === "UNKNOWN") {
    return prior?.status === "ERP_CONFIRMED" ||
      prior?.status === "ERP_RECONCILIATION_REQUIRED"
      ? prior
      : {
          procurementCommitmentId: award.procurementCommitmentId,
          erpPurchaseOrderId: null,
          status: "ERP_RECONCILIATION_REQUIRED",
          evidenceEventId: evidence.sourceEventId,
        }
  }
  if (!identifier(evidence.erpPurchaseOrderId)) {
    throw new Error("ERP did not attest a native purchase order identity")
  }
  if (
    prior?.erpPurchaseOrderId &&
    prior.erpPurchaseOrderId !== evidence.erpPurchaseOrderId
  ) {
    throw new Error("ERP evidence conflicts with an existing purchase order projection")
  }
  return {
    procurementCommitmentId: award.procurementCommitmentId,
    erpPurchaseOrderId: evidence.erpPurchaseOrderId,
    status: "ERP_CONFIRMED",
    evidenceEventId: evidence.sourceEventId,
  }
}
