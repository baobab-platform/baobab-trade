// Gate ZB-03.3 (Buyer IAM -> CP -> Trade integration): the first real HTTP
// route that composes a BuyerContext from the DB (src/baobab/b2b's pure
// policy layer -- assertActiveBuyerContext, decidePurchase -- previously had
// no caller that ever built one from real membership/role rows; every
// existing test constructed a BuyerContext by hand).
//
// canonical_organisation_id is the value baobab-cp's
// /v1/platform-context/resolve returns as organisation_id once ADR-BCP-016's
// verification stage resolves it (baobab-cp gate ZB-03.2/3.3) -- this route
// never trusts a bare Trade-local organisation id from the caller, only the
// CP-verified canonical identifier, then resolves it to this engine's own
// b2b_organisation row via canonical_organisation_id (populated by the
// admin canonical-link route, src/api/admin/b2b/organisations/[id]/
// canonical-link/route.ts).
//
// Gate ZB-03.6: b2b_organisation.tenant_id is otherwise Trade-local/
// admin-set, never independently checked against baobab-cp's canonical
// registry. When a workload verifier is configured (see
// getWorkloadTenantVerifier), this route additionally attests that CP's
// own record agrees tenant_id belongs to this organisation before serving
// context -- opt-in, so this is skipped entirely where unconfigured.
import { randomUUID } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import {
  assertActiveBuyerContext,
  B2BAuthorizationError,
  resolveBuyerContext,
} from "../../../../baobab/b2b"
import { getWorkloadTenantVerifier } from "../../../../baobab/control-plane/workload-tenant-verifier"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const canonicalOrganisationId = req.query.canonical_organisation_id
  if (typeof canonicalOrganisationId !== "string" || canonicalOrganisationId.trim() === "") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "canonical_organisation_id query parameter is required",
    )
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  const organisations = await b2b.listB2BOrganisations({
    canonical_organisation_id: canonicalOrganisationId,
  })
  if (organisations.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "no organisation is linked to that canonical_organisation_id",
    )
  }
  const organisation = organisations[0]

  const tenantVerifier = getWorkloadTenantVerifier()
  if (tenantVerifier) {
    try {
      await tenantVerifier.verifyOrganisationTenant(
        organisation.tenant_id,
        canonicalOrganisationId,
        req.headers["x-correlation-id"]?.toString() || randomUUID(),
      )
    } catch {
      throw new MedusaError(
        MedusaError.Types.FORBIDDEN,
        "the Control Plane could not attest this organisation's tenant",
      )
    }
  }

  const context = await resolveBuyerContext(b2b, organisation.id, req.auth_context.actor_id)
  if (!context) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "the authenticated buyer has no membership in this organisation",
    )
  }
  try {
    assertActiveBuyerContext(context, organisation.id)
  } catch (error) {
    if (error instanceof B2BAuthorizationError) {
      throw new MedusaError(MedusaError.Types.FORBIDDEN, error.message)
    }
    throw error
  }

  res.status(200).json({
    organisation: {
      id: organisation.id,
      canonical_organisation_id: organisation.canonical_organisation_id,
      status: organisation.status,
    },
    membership: { id: context.membershipId, status: context.membershipStatus },
    roles: context.roles,
  })
}
