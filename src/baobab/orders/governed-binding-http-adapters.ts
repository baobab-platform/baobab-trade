import type {
  BindingAuthorityPorts,
  VerifiedActor,
  VerifiedEvidence,
} from "./governed-binding-service"
type LegalAuthorityPort = BindingAuthorityPorts["legalAuthority"]
type IamPort = BindingAuthorityPorts["iam"]
type EvidencePort = BindingAuthorityPorts["evidence"]
import type { GovernedBindingScope } from "./governed-binding-command-policy"
import { HttpControlPlaneClient } from "../control-plane/client"
import { ClientCredentialsWorkloadTokenProvider } from "../control-plane/workload-token"

/**
 * CP reattestation using the already-integrated Trade workload credentials.
 * This is a context check, not an assertion that a LegalEntity has a mandate.
 */
export class ControlPlaneBindingAuthority implements LegalAuthorityPort {
  constructor(
    private readonly cp: HttpControlPlaneClient,
    private readonly workload: ClientCredentialsWorkloadTokenProvider,
  ) {}
  async assertCurrent(scope: GovernedBindingScope): Promise<void> {
    const token = await this.workload.getAccessToken()
    const response = await this.cp.resolvePlatformContext(
      scope.tenantId,
      scope.organisationId,
      token,
      crypto.randomUUID(),
    )
    if (
      response.tenant_id !== scope.tenantId ||
      response.organisation_id !== scope.organisationId ||
      response.country_code !== scope.marketCode ||
      response.currency_code !== scope.currencyCode ||
      !Number.isFinite(Date.parse(response.resolved_at)) ||
      Date.parse(response.resolved_at) > Date.now() ||
      Date.parse(response.resolved_at) < Date.now() - 30000 ||
      (response.expires_at && Date.parse(response.expires_at) <= Date.now())
    ) {
      throw new Error("LA-05C5 denied: CP context is not current for seller market")
    }
  }
}

/**
 * IAM verification is intentionally performed by a trusted IAM gateway.
 * Gateway must cryptographically verify token signature, issuer, audience,
 * expiry, human assurance, tenancy and operation scope; never decode JWT locally.
 * Endpoint is a trusted internal service and must not be supplied by a browser.
 */
export class HttpIamHumanVerifier implements IamPort {
  constructor(
    private readonly endpoint: string,
    private readonly workloadToken: () => Promise<string>,
  ) {
    const u = new URL(endpoint)
    if (u.protocol !== "https:") throw new Error("LA-05C5 IAM verifier requires HTTPS")
  }
  async verify(token: string, operation: "propose" | "approve" | "revoke"): Promise<VerifiedActor> {
    if (!token.trim()) throw new Error("LA-05C5 denied: missing human credential")
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.workloadToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token, audience: "baobab-trade", operation }),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new Error("LA-05C5 denied: IAM verification unavailable")
    const actor: unknown = await response.json()
    if (!actor || typeof actor !== "object") throw new Error("LA-05C5 denied: invalid IAM response")
    const a = actor as Partial<VerifiedActor>
    if (
      !a.subject ||
      !a.issuer ||
      !a.tokenId ||
      a.audience !== "baobab-trade" ||
      !a.tenantId ||
      !a.organisationId ||
      !Array.isArray(a.scopes) ||
      !a.scopes.includes(`trade:legal-seller-binding:${operation}`)
    ) {
      throw new Error("LA-05C5 denied: IAM verification missing mandatory claims")
    }
    return a as VerifiedActor
  }
}

/** Evidence verification is authoritative only if the server confirms scope and decision. */
export class HttpBindingEvidenceVerifier implements EvidencePort {
  constructor(
    private readonly endpoint: string,
    private readonly workloadToken: () => Promise<string>,
  ) {
    if (new URL(endpoint).protocol !== "https:")
      throw new Error("LA-05C5 evidence verifier requires HTTPS")
  }
  async verify(reference: string, scope: GovernedBindingScope): Promise<VerifiedEvidence> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.workloadToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reference, scope }),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new Error("LA-05C5 denied: evidence verifier unavailable")
    const value: unknown = await response.json()
    if (!value || typeof value !== "object")
      throw new Error("LA-05C5 denied: invalid evidence response")
    const evidence = value as Partial<VerifiedEvidence>
    if (
      evidence.reference !== reference ||
      !evidence.decisionId ||
      !evidence.verifiedAt ||
      !Number.isFinite(Date.parse(evidence.verifiedAt))
    ) {
      throw new Error("LA-05C5 denied: evidence not verified")
    }
    return evidence as VerifiedEvidence
  }
}
