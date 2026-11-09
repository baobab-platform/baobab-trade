// ADR-0017 CUS-COM-004/007–011/026/030: a buyer must explicitly select
// one organisation. This is a legacy account-shell status read ONLY, not an
// IAM/CP purchasing decision. Catalogues, orders, documents and team
// management remain disabled on this Medusa-customer route.
import { randomUUID } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { resolveBuyerTenantId, principalIdFromAuthContext } from "../../../../baobab/b2b/onboarding-policy"
import { resolveSelectedOrganisationCapability } from "../../../../baobab/b2b/capability-selection"
import { getWorkloadTenantVerifier } from "../../../../baobab/control-plane/workload-tenant-verifier"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const customerId = req.auth_context.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "customer authentication is required")
  }
  const value = req.query.organisation_id
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "organisation_id must be a selected identifier")
  }

  let authorised: Awaited<ReturnType<typeof resolveSelectedOrganisationCapability>> = null
  if (typeof value === "string") {
    const principal = principalIdFromAuthContext(req.auth_context)
    if (principal) {
      const verifier = getWorkloadTenantVerifier()
      if (!verifier) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Buyer capability source unavailable")
      }
      try {
        authorised = await resolveSelectedOrganisationCapability(
          req.scope.resolve<B2BModuleService>(B2B_MODULE),
          verifier,
          {
            tenantId: resolveBuyerTenantId(),
            customerId,
            principalId: principal,
            selectedOrganisationId: value,
            correlationId: randomUUID(),
          },
        )
      } catch {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Buyer capability source unavailable")
      }
    }
  }

  return res.status(200).json({
    organisation_id: authorised?.organisationId ?? null,
    organisation_status: authorised?.status ?? null,
    selection_required: authorised === null,
    capabilities: {
      organisation: authorised !== null,
      // A Medusa session/CP organisation attestation does NOT prove the
      // human's IAM authority to manage other buyers or spend money.
      team: false,
      catalogue: false,
      orders: false,
      documents: false,
    },
  })
}
