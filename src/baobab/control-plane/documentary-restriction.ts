/** PEO-02T / LA-05C6: CP returns a current NEGATIVE veto, never a grant. */
export type DocumentaryRestrictionRequest = {
  context_id: string
  capability: string
  market: string
  operation_reference: string
}

export type DocumentaryRestrictionResponse = DocumentaryRestrictionRequest & {
  organisation_id: string
  blocked: boolean
  authority_granted: false
  policy_reference: string
  evaluated_at: string
  expires_at: string
}

export interface DocumentaryRestrictionPort {
  assess(
    request: DocumentaryRestrictionRequest,
    workloadAccessToken: string,
    correlationId: string,
  ): Promise<DocumentaryRestrictionResponse>
}

export function assertUnblockedDocumentaryScope(
  raw: unknown,
  expected: DocumentaryRestrictionRequest & { organisation_id: string },
  nowMs: number,
): void {
  if (!raw || typeof raw !== "object") {
    throw new Error("Documentary restriction denied: missing CP decision")
  }
  const result = raw as Record<string, unknown>
  if (
    result.context_id !== expected.context_id ||
    result.organisation_id !== expected.organisation_id ||
    result.market !== expected.market ||
    result.capability !== expected.capability ||
    result.operation_reference !== expected.operation_reference ||
    result.authority_granted !== false ||
    result.blocked !== false ||
    result.policy_reference !== "ADR-BCP-026/PEO-02T:negative-only"
  ) {
    throw new Error("Documentary restriction denied: blocked or mismatched CP scope")
  }
  if (typeof result.evaluated_at !== "string" || typeof result.expires_at !== "string") {
    throw new Error("Documentary restriction denied: absent validity window")
  }
  const evaluated = Date.parse(result.evaluated_at)
  const expires = Date.parse(result.expires_at)
  if (
    !Number.isFinite(evaluated) || !Number.isFinite(expires) ||
    evaluated > nowMs + 1000 ||
    evaluated < nowMs - 3000 ||
    expires <= nowMs ||
    expires > evaluated + 2000
  ) {
    throw new Error("Documentary restriction denied: stale or excessive decision lease")
  }
}

export class HttpDocumentaryRestrictionClient implements DocumentaryRestrictionPort {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {
    if (
      !/^https:\/\//.test(baseUrl) &&
      !/^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(baseUrl)
    ) {
      throw new Error("Documentary restriction client requires HTTPS")
    }
  }

  async assess(
    request: DocumentaryRestrictionRequest,
    workloadAccessToken: string,
    correlationId: string,
  ): Promise<DocumentaryRestrictionResponse> {
    if (
      !workloadAccessToken.trim() || !request.context_id.trim() ||
      !/^[a-z][a-z0-9._-]{2,199}$/.test(request.capability) ||
      !/^[A-Z]{2}$/.test(request.market) ||
      !request.operation_reference.trim() ||
      !correlationId.trim()
    ) {
      throw new Error("Documentary restriction denied: invalid authenticated scope")
    }
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/internal/documentary/v1/restrictions/assess`,
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
    if (!response.ok) {
      throw new Error("Documentary restriction denied: current CP authority unavailable")
    }
    const payload: unknown = await response.json()
    // Caller still checks the exact Organisation binding and lease against
    // the server-owned cart row, immediately before native completion.
    if (!payload || typeof payload !== "object") {
      throw new Error("Documentary restriction denied: invalid CP response")
    }
    return payload as DocumentaryRestrictionResponse
  }
}
