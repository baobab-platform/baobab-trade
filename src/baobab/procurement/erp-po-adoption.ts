/**
 * ADR-0019 §§31–35, 93–104, 122: Trade supplier award is NOT an ERP PO.
 * This consumer validates ERP-owned PO evidence without mutating ERP state.
 */
export type ApprovedSupplierAward = Readonly<{
  tenantId: string
  procurementCommitmentId: string
  approvedAwardId: string
  approvedSupplierCanonicalId: string
  buyerLegalEntityId: string
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
  buyerLegalEntityId: string
  currency: string
  committedTotalMinor: number
  idempotencyKey: string
  erpPurchaseOrderId: string
  status: "CREATED" | "APPROVED" | "REJECTED" | "UNKNOWN"
}>

export type PurchaseOrderProjection = Readonly<{
  procurementCommitmentId: string
  erpPurchaseOrderId: string | null
  status: "ERP_PENDING" | "ERP_CONFIRMED" | "ERP_RECONCILIATION_REQUIRED"
  evidenceEventId: string | null
}>

const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 256

/**
 * A success-looking ERP reply cannot become supplier-facing PO confirmation
 * if its legal buyer, supplier, award, amount or command identity differs.
 * An unknown outcome must be reconciled, not blindly replayed.
 */
export function reconcileSupplierAwardToErp(
  award: ApprovedSupplierAward,
  evidence: ErpPurchaseOrderEvidence | null,
  prior?: PurchaseOrderProjection | null,
): PurchaseOrderProjection {
  const fields = [
    award.tenantId, award.procurementCommitmentId, award.approvedAwardId,
    award.approvedSupplierCanonicalId, award.buyerLegalEntityId, award.idempotencyKey,
  ]
  if (
    award.status !== "APPROVED" ||
    fields.some((field) => !identifier(field)) ||
    !/^[A-Z]{3}$/.test(award.currency) ||
    !Number.isSafeInteger(award.totalMinor) || award.totalMinor < 0
  ) {
    throw new Error("Procurement award is not a valid, authorised commercial commitment")
  }
  if (prior && prior.procurementCommitmentId !== award.procurementCommitmentId) {
    throw new Error("Procurement projection belongs to a different commitment")
  }
  if (evidence === null) {
    return prior?.status === "ERP_CONFIRMED"
      ? prior
      : { procurementCommitmentId: award.procurementCommitmentId,
          erpPurchaseOrderId: null, status: "ERP_PENDING", evidenceEventId: null }
  }
  if (
    evidence.source !== "ERP" ||
    evidence.tenantId !== award.tenantId ||
    evidence.procurementCommitmentId !== award.procurementCommitmentId ||
    evidence.approvedAwardId !== award.approvedAwardId ||
    evidence.supplierCanonicalId !== award.approvedSupplierCanonicalId ||
    evidence.buyerLegalEntityId !== award.buyerLegalEntityId ||
    evidence.currency !== award.currency ||
    evidence.committedTotalMinor !== award.totalMinor ||
    evidence.idempotencyKey !== award.idempotencyKey ||
    !identifier(evidence.sourceEventId)
  ) {
    throw new Error("ERP PO evidence does not match the approved procurement commitment")
  }
  if (evidence.status !== "CREATED" && evidence.status !== "APPROVED") {
    return prior?.status === "ERP_CONFIRMED"
      ? prior
      : { procurementCommitmentId: award.procurementCommitmentId,
          erpPurchaseOrderId: null, status: "ERP_RECONCILIATION_REQUIRED",
          evidenceEventId: evidence.sourceEventId }
  }
  if (!identifier(evidence.erpPurchaseOrderId)) {
    throw new Error("ERP did not attest a native purchase order identity")
  }
  if (
    prior?.status === "ERP_CONFIRMED" &&
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
