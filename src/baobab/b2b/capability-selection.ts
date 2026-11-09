import type B2BModuleService from "../../modules/b2b/service"
import type { WorkloadTenantVerifier } from "../control-plane/workload-tenant-verifier"

/** ADR-0017 CUS-COM-004/007–011/026/030: Medusa login alone grants
 * no buyer organisation selection or purchasing authority.
 */
type Service = Pick<B2BModuleService, "listBuyerMemberships" | "listB2BOrganisations">
export type SelectedOrganisationCapability = {
  organisationId: string
  status: "ACTIVE"
}

const inEffect = (from: Date | string | null | undefined, to: Date | string | null | undefined, now: number): boolean => {
  const start = from == null ? -Infinity : new Date(from).getTime()
  const end = to == null ? Infinity : new Date(to).getTime()
  return !Number.isNaN(start) && !Number.isNaN(end) && start < end && start <= now && now < end
}

export async function resolveSelectedOrganisationCapability(
  service: Service,
  verifier: WorkloadTenantVerifier,
  args: {
    tenantId: string
    customerId: string
    principalId: string
    selectedOrganisationId: string
    correlationId: string
  },
  now = Date.now(),
): Promise<SelectedOrganisationCapability | null> {
  const { tenantId, customerId, principalId, selectedOrganisationId, correlationId } = args
  if (
    !tenantId || !customerId || !principalId ||
    !selectedOrganisationId || !correlationId || !Number.isFinite(now)
  ) return null
  const memberships = await service.listBuyerMemberships({
    organisation_id: selectedOrganisationId,
    customer_id: customerId,
    status: "ACTIVE",
  })
  if (memberships.length !== 1) return null
  const m = memberships[0]
  if (
    m.organisation_id !== selectedOrganisationId ||
    m.customer_id !== customerId ||
    m.principal_id !== principalId ||
    m.status !== "ACTIVE" ||
    !inEffect(m.effective_from, m.effective_until, now)
  ) return null

  const organisations = await service.listB2BOrganisations({ id: [selectedOrganisationId] })
  if (organisations.length !== 1) return null
  const o = organisations[0]
  if (
    o.id !== selectedOrganisationId ||
    o.tenant_id !== tenantId ||
    o.status !== "ACTIVE" ||
    !o.canonical_organisation_id
  ) return null

  // Only after membership is proven do we ask CP to attest that the selected
  // canonical buyer organisation belongs to the seller-side tenant.
  const cp = await verifier.verifyOrganisationTenant(
    tenantId,
    o.canonical_organisation_id,
    correlationId,
  )
  if (!cp.contextId || !cp.expiresAt || !(cp.expiresAt.getTime() > now)) return null
  return { organisationId: selectedOrganisationId, status: "ACTIVE" }
}
