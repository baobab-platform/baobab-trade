// Gate ZB-04 — accept a buyer organisation invitation.
// Authenticated customer presents invitation_token; membership moves INVITED → ACTIVE
// and is bound to their Medusa customer_id. One active membership per customer.
import { createHash } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../modules/b2b"
import type B2BModuleService from "../../../../../modules/b2b/service"

type AcceptBody = {
  invitation_token?: unknown
}

export const POST = async (req: AuthenticatedMedusaRequest<AcceptBody>, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }

  const token = req.body?.invitation_token
  if (typeof token !== "string" || token.trim() === "") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "invitation_token is required")
  }

  const tokenHash = createHash("sha256").update(token.trim()).digest("hex")
  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)

  const matches = await b2b.listBuyerMemberships({
    invitation_token_hash: tokenHash,
    status: "INVITED",
  })
  if (matches.length !== 1) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "invitation is invalid or already used")
  }
  const membership = matches[0]

  if (membership.invitation_expires_at && new Date(membership.invitation_expires_at) < new Date()) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "invitation has expired")
  }

  const existing = await b2b.listBuyerMemberships({
    customer_id: customerId,
  })
  const blocking = existing.filter(
    (m) => m.id !== membership.id && (m.status === "ACTIVE" || m.status === "INVITED"),
  )
  if (blocking.length > 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "this customer already belongs to a buyer organisation",
    )
  }

  const organisation = await b2b.retrieveB2BOrganisation(membership.organisation_id)
  if (organisation.status === "CLOSED") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "organisation is closed")
  }

  const updated = await b2b.updateBuyerMemberships(membership.id, {
    customer_id: customerId,
    principal_id: customerId,
    status: "ACTIVE",
    invitation_accepted_at: new Date(),
    invitation_token_hash: null,
    invitation_expires_at: null,
    effective_from: new Date(),
  })

  res.status(200).json({
    membership: {
      id: updated.id,
      status: updated.status,
      organisation_id: updated.organisation_id,
      customer_id: updated.customer_id,
    },
    organisation: {
      id: organisation.id,
      legal_name: organisation.legal_name,
      status: organisation.status,
    },
  })
}
