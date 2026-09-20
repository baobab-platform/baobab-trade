import { getBaobabTradeEnvironment } from "../config/environment"
import { HttpControlPlaneClient, type ControlPlaneClient } from "../control-plane/client"
import {
  ClientCredentialsWorkloadTokenProvider,
  type WorkloadTokenProvider,
} from "../control-plane/workload-token"

export const CANONICAL_ORGANISATION_VERIFIER = "canonicalOrganisationVerifier"

export type CanonicalOrganisationVerification = {
  verified: boolean
  canonicalOrganisationId: string
  kind: "BUYER_ORGANISATION"
  verifiedAt: string
}

export interface CanonicalOrganisationVerifier {
  verify(input: {
    tenantId: string
    canonicalOrganisationId: string
    expectedKind: "BUYER_ORGANISATION"
  }): Promise<CanonicalOrganisationVerification>
}

export class ControlPlaneCanonicalOrganisationVerifier
  implements CanonicalOrganisationVerifier
{
  constructor(
    private readonly tokenProvider: WorkloadTokenProvider,
    private readonly controlPlaneClient: ControlPlaneClient,
  ) {}

  async verify(input: {
    tenantId: string
    canonicalOrganisationId: string
    expectedKind: "BUYER_ORGANISATION"
  }): Promise<CanonicalOrganisationVerification> {
    const accessToken = await this.tokenProvider.getAccessToken()
    const correlationId = crypto.randomUUID()
    const attestation = await this.controlPlaneClient.resolvePlatformContext(
      input.tenantId,
      input.canonicalOrganisationId,
      accessToken,
      correlationId,
      input.expectedKind,
    )

    const verified =
      attestation.tenant_id === input.tenantId &&
      attestation.organisation_id === input.canonicalOrganisationId &&
      attestation.organisation_type === input.expectedKind

    return {
      verified,
      canonicalOrganisationId: attestation.organisation_id ?? "",
      kind: input.expectedKind,
      verifiedAt: attestation.resolved_at,
    }
  }
}

let singleton: CanonicalOrganisationVerifier | null | undefined

export const getCanonicalOrganisationVerifier =
  (): CanonicalOrganisationVerifier | null => {
    if (singleton !== undefined) return singleton

    const env = getBaobabTradeEnvironment()
    if (
      !env.iamWorkloadTokenUrl ||
      !env.iamWorkloadClientSecret ||
      !env.controlPlaneBaseUrl
    ) {
      singleton = null
      return singleton
    }

    const tokenProvider = new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: env.iamWorkloadTokenUrl,
      clientId: env.iamWorkloadClientId,
      clientSecret: env.iamWorkloadClientSecret,
    })
    const client = new HttpControlPlaneClient({
      baseUrl: env.controlPlaneBaseUrl,
      contextPath: env.controlPlaneContextPath,
      productId: env.controlPlaneProductId,
      marketPathTemplate: env.controlPlaneMarketPathTemplate,
      mappingResolutionPath: env.controlPlaneMappingResolutionPath,
      platformContextPath: env.controlPlanePlatformContextPath,
    })
    singleton = new ControlPlaneCanonicalOrganisationVerifier(
      tokenProvider,
      client,
    )
    return singleton
  }

export const resetCanonicalOrganisationVerifierForTests = (): void => {
  singleton = undefined
}
