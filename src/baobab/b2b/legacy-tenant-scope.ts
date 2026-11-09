import { MedusaError } from "@medusajs/framework/utils"
import type B2BModuleService from "../../modules/b2b/service"
import { resolveBuyerTenantId } from "./onboarding-policy"

/**
 * ADR-0009 §§15–20, 42, 61–63: legacy ZuriBeans Medusa-session routes
 * must prove the Trade-local organisation belongs to the estate's
 * server-selected tenant before reading membership, role or private data.
 *
 * This is NOT a substitute for IAM/CP buyer identity, capability binding or
 * Control Plane tenant attestation. It only prevents cross-tenant native
 * resource access in the legacy onboarding surface.
 */
export const assertLegacyTenantOwnership = (
  organisation: { id: string; tenant_id: string | null },
  requestedOrganisationId: string,
): void => {
  const tenantId = resolveBuyerTenantId()
  if (
    !requestedOrganisationId ||
    organisation.id !== requestedOrganisationId ||
    !organisation.tenant_id ||
    organisation.tenant_id !== tenantId
  ) {
    // Same response for foreign-tenant and inaccessible organisation IDs:
    // do not reveal that a protected resource exists in another tenant.
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "buyer organisation was not found")
  }
}

export const requireLegacyTenantOrganisation = async (
  b2b: Pick<B2BModuleService, "retrieveB2BOrganisation">,
  organisationId: string,
): Promise<Awaited<ReturnType<B2BModuleService["retrieveB2BOrganisation"]>>> => {
  // Refuse missing trusted configuration before touching the organisation table.
  resolveBuyerTenantId()
  if (!organisationId?.trim()) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "buyer organisation was not found")
  }
  const organisation = await b2b.retrieveB2BOrganisation(organisationId)
  assertLegacyTenantOwnership(organisation, organisationId)
  return organisation
}
