import { getBaobabTradeEnvironment } from "../config/environment"
import { HttpControlPlaneClient, type ControlPlaneClient } from "./client"
import {
  ClientCredentialsWorkloadTokenProvider,
  type WorkloadTokenProvider,
} from "./workload-token"

/**
 * Gate ZB-03.6: attests, at read time, that a Trade-local
 * b2b_organisation.tenant_id actually belongs to the tenant baobab-cp's
 * canonical registry has on file for that organisation's
 * canonical_organisation_id. `tenant_id` on that row is Trade-local/
 * admin-set (see docs/adr/ADR-BCP-016 and this slice's own ADR) -- never
 * independently CP-verified at organisation-creation time -- so this
 * closes that gap for every read going forward, without retroactively
 * proving past writes were correct.
 *
 * Deliberately opt-in: returns null when the workload client secret isn't
 * configured, preserving pre-ZB-03.6 behaviour unless an operator
 * explicitly enables it. See this slice's ADR for why it isn't
 * requiredInProduction.
 */
export interface WorkloadTenantVerifier {
  verifyOrganisationTenant(
    tenantId: string,
    canonicalOrganisationId: string,
    correlationId: string,
  ): Promise<void>
}

export class TenantAttestationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TenantAttestationError"
  }
}

export class ControlPlaneWorkloadTenantVerifier implements WorkloadTenantVerifier {
  constructor(
    private readonly tokenProvider: WorkloadTokenProvider,
    private readonly controlPlaneClient: ControlPlaneClient,
  ) {}

  async verifyOrganisationTenant(
    tenantId: string,
    canonicalOrganisationId: string,
    correlationId: string,
  ): Promise<void> {
    const accessToken = await this.tokenProvider.getAccessToken()
    const resolved = await this.controlPlaneClient.resolvePlatformContext(
      tenantId,
      canonicalOrganisationId,
      accessToken,
      correlationId,
    )

    // Never trust a bare 200 -- confirm the Control Plane actually echoed
    // back the tenant_id being asserted, not merely that it resolved some
    // context for the organisation.
    if (resolved.tenant_id !== tenantId) {
      throw new TenantAttestationError(
        "Control Plane platform context does not attest the asserted tenant for this organisation",
      )
    }
  }
}

let singleton: WorkloadTenantVerifier | null | undefined

/**
 * Returns a process-wide singleton verifier so the token provider's and
 * control-plane client's internal caches persist across requests, or null
 * when the workload client secret is not configured. Memoized after first
 * call; primarily useful in tests is `resetWorkloadTenantVerifierForTests`.
 */
export const getWorkloadTenantVerifier = (): WorkloadTenantVerifier | null => {
  if (singleton !== undefined) {
    return singleton
  }

  const env = getBaobabTradeEnvironment()
  if (!env.iamWorkloadTokenUrl || !env.iamWorkloadClientSecret || !env.controlPlaneBaseUrl) {
    singleton = null
    return singleton
  }

  const tokenProvider = new ClientCredentialsWorkloadTokenProvider({
    tokenUrl: env.iamWorkloadTokenUrl,
    clientId: env.iamWorkloadClientId,
    clientSecret: env.iamWorkloadClientSecret,
  })
  const controlPlaneClient = new HttpControlPlaneClient({
    baseUrl: env.controlPlaneBaseUrl,
    contextPath: env.controlPlaneContextPath,
    productId: env.controlPlaneProductId,
    marketPathTemplate: env.controlPlaneMarketPathTemplate,
    mappingResolutionPath: env.controlPlaneMappingResolutionPath,
    platformContextPath: env.controlPlanePlatformContextPath,
  })

  singleton = new ControlPlaneWorkloadTenantVerifier(tokenProvider, controlPlaneClient)
  return singleton
}

export const resetWorkloadTenantVerifierForTests = (): void => {
  singleton = undefined
}
