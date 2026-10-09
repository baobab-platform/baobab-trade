/**
 * ADR-BCP-027 LA-05C: Trade consumes the CP LA-05A current legal-actor
 * FACT, not a parent-company inference or a tenant DEFAULT LegalEntity.
 * This client grants no downstream Medusa seller/provider permission.
 */
export type LegalActorRequest = {
  context_id: string
  role: "SELLER_OF_RECORD"
  activity: string
  market: string
  capability: string
  operation_reference: string
}

export type LegalActorDecision = {
  context_id: string
  operation_reference: string
  provider_permissions_granted: false
  legal_actor_resolution: {
    outcome: string
    evaluated_at: string
    policy_reference: string
    mandate_id?: string
    responsible_legal_entity_id?: string
    evidence_references?: string[]
    valid_until?: string
  }
}

export interface LegalActorAssessmentPort {
  assess(
    request: LegalActorRequest,
    workloadAccessToken: string,
    correlationId: string,
  ): Promise<LegalActorDecision>
}

export class HttpLegalActorAssessmentClient implements LegalActorAssessmentPort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3000,
  ) {
    if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(baseUrl))
      throw new Error("Production CP legal actor assessment requires HTTPS")
  }

  async assess(request: LegalActorRequest, workloadAccessToken: string, correlationId: string) {
    if (
      !workloadAccessToken.trim() ||
      !request.context_id.trim() ||
      !/^[A-Z]{2}$/.test(request.market) ||
      !request.operation_reference.trim() ||
      !request.activity.trim() ||
      !request.capability.trim() ||
      request.role !== "SELLER_OF_RECORD"
    ) {
      throw new Error("Invalid legal-actor assessment request")
    }
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/internal/legal-actor/v1/assess`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${workloadAccessToken}`,
          "content-type": "application/json",
          "x-correlation-id": correlationId,
          "cache-control": "no-store",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    )
    if (!response.ok) throw new Error("Control Plane legal-actor assessment unavailable or denied")
    const payload: unknown = await response.json()
    if (!isLegalActorDecision(payload, request)) {
      throw new Error("Invalid Control Plane legal-actor assessment: fail closed")
    }
    return payload
  }
}

export function isLegalActorDecision(
  value: unknown,
  request: LegalActorRequest,
): value is LegalActorDecision {
  if (!value || typeof value !== "object") return false
  const result = value as Record<string, unknown>
  if (
    result.context_id !== request.context_id ||
    result.operation_reference !== request.operation_reference ||
    result.provider_permissions_granted !== false
  )
    return false
  const r = result.legal_actor_resolution
  if (!r || typeof r !== "object") return false
  const authority = r as Record<string, unknown>
  if (
    typeof authority.outcome !== "string" ||
    typeof authority.evaluated_at !== "string" ||
    typeof authority.policy_reference !== "string" ||
    !Number.isFinite(Date.parse(authority.evaluated_at)) ||
    authority.policy_reference.trim() === ""
  )
    return false
  if (authority.outcome === "AUTHORIZED") {
    return (
      typeof authority.mandate_id === "string" &&
      /^[a-f0-9-]{36}$/i.test(authority.mandate_id) &&
      typeof authority.responsible_legal_entity_id === "string" &&
      authority.responsible_legal_entity_id.trim().length > 0 &&
      Array.isArray(authority.evidence_references) &&
      authority.evidence_references.length > 0 &&
      authority.evidence_references.every((e) => typeof e === "string" && e.length > 0) &&
      typeof authority.valid_until === "string" &&
      Number.isFinite(Date.parse(authority.valid_until))
    )
  }
  return !("mandate_id" in authority) && !("responsible_legal_entity_id" in authority)
}
