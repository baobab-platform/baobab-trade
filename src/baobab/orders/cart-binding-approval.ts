/**
 * LA-05C3 admission policy: a signed platform approval is evidence for a
 * server-owned cart binding, not permission to create a CP LegalEntity.
 * The current module deliberately offers NO HTTP grant-minting endpoint.
 */
export type CartBindingApproval = {
  cartId: string
  proposedBy: string
  proposedAt: string
  approvedBy: string
  approvedAt: string
  approvalReference: string
  approvalScope: string
  expiresAt: string
}

export function assertIndependentlyApprovedBinding(row: CartBindingApproval, atMs: number): void {
  const proposed = Date.parse(row.proposedAt)
  const approved = Date.parse(row.approvedAt)
  const expires = Date.parse(row.expiresAt)
  if (
    !row.cartId?.trim() ||
    !row.proposedBy?.trim() ||
    !row.approvedBy?.trim() ||
    row.proposedBy === row.approvedBy ||
    !row.approvalReference?.trim() ||
    row.approvalScope !== "SELLER_OF_RECORD_CART_BINDING" ||
    !Number.isFinite(proposed) ||
    !Number.isFinite(approved) ||
    !Number.isFinite(expires) ||
    proposed > approved ||
    approved > atMs ||
    expires <= atMs ||
    expires <= approved
  ) {
    throw new Error("LA-05C3 denied: independent maker/checker approval absent or expired")
  }
}
