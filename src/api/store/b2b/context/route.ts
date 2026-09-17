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
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../modules/b2b"
import type B2BModuleService from "../../../../modules/b2b/service"
import {
  assertActiveBuyerContext,
  B2BAuthorizationError,
  resolveBuyerContext,
} from "../../../../baobab/b2b"

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
