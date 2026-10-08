// Gate ZB-03.3: the onboarding/backfill mechanism that populates
// b2b_organisation.canonical_organisation_id -- declared on the model since
// its creation (src/modules/b2b/models/b2b-organisation.ts) but, until now,
// never set by any code path in this repository (confirmed by grep before
// this change: only the model/migration declarations and one unused
// event-payload field referenced the column). An operator uses this after
// linking the same canonical identity to a BUYER_ORGANISATION CanonicalEntity
// in baobab-cp (POST /v1/canonical-entities/{entityID}/external-references),
// so the two engines agree on one canonical_organisation_id for the same
// real-world organisation.
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { B2B_MODULE } from "../../../../../../modules/b2b"
import type B2BModuleService from "../../../../../../modules/b2b/service"

type CanonicalLinkBody = {
  canonical_organisation_id?: unknown
}

export const POST = async (
  req: AuthenticatedMedusaRequest<CanonicalLinkBody>,
  res: MedusaResponse,
) => {
  const canonicalOrganisationId = req.body?.canonical_organisation_id
  if (typeof canonicalOrganisationId !== "string" || canonicalOrganisationId.trim() === "") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "canonical_organisation_id is required in the request body",
    )
  }

  const b2b = req.scope.resolve<B2BModuleService>(B2B_MODULE)
  // Throws MedusaError NOT_FOUND itself when the id does not exist --
  // consistent with every other admin resource lookup in this codebase.
  await b2b.retrieveB2BOrganisation(req.params.id)

  const updated = await b2b.updateB2BOrganisations(req.params.id, {
    canonical_organisation_id: canonicalOrganisationId,
  })

  res.status(200).json({
    id: updated.id,
    canonical_organisation_id: updated.canonical_organisation_id,
  })
}
