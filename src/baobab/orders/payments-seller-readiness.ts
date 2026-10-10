import type {
  GovernedSellerOrderCommand,
  LegalSellerEvidence,
  LegalSellerProviderReadiness,
} from "./governed-legal-seller"
import type { WorkloadTokenProvider } from "../control-plane/workload-token"

/**
 * LA-05C3 candidate Payments-side contract. This adapter MUST fail closed
 * until Payments publishes an authenticated, certified live implementation.
 * Neither Trade nor CP can self-certify PSP/merchant routing eligibility.
 */
export type PaymentsReadinessRequest = {
  tenant_id: string
  organisation_id: string
  responsible_legal_entity_id: string
  market: string
  currency_code: string
  capability: string
  operation_reference: string
  mandate_id: string
}
export type PaymentsReadinessDecision = PaymentsReadinessRequest & {
  outcome: "READY"
  provider_certification_reference: string
  merchant_activation_reference: string
  policy_reference: string
  evaluated_at: string
  valid_until: string
}

const nonempty = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0

export function assertCurrentPaymentsReadiness(
  input: unknown,
  expected: PaymentsReadinessRequest,
  now: number,
): void {
  if (!input || typeof input !== "object") {
    throw new Error("Payments readiness denied: missing decision")
  }
  const result = input as Record<string, unknown>
  for (const [key, value] of Object.entries(expected)) {
    if (result[key] !== value) {
      throw new Error("Payments readiness denied: operation context mismatch")
    }
  }
  if (
    result.outcome !== "READY" ||
    !nonempty(result.provider_certification_reference) ||
    !nonempty(result.merchant_activation_reference) ||
    !nonempty(result.policy_reference) ||
    !nonempty(result.evaluated_at) ||
    !nonempty(result.valid_until)
  ) {
    throw new Error("Payments readiness denied: no certified merchant activation")
  }
  const issued = Date.parse(result.evaluated_at)
  const until = Date.parse(result.valid_until)
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(until) ||
    issued > now + 1000 ||
    issued < now - 30_000 ||
    until <= now ||
    until > issued + 30_000 + 1000
  ) {
    throw new Error("Payments readiness denied: expired or excessive decision lease")
  }
}

export type PaymentsReadinessOptions = {
  url: string
  tokens: WorkloadTokenProvider
  timeoutMs?: number
  now?: () => number
}

export class HttpPaymentsMerchantReadinessAdapter implements LegalSellerProviderReadiness {
  private readonly url: string
  private readonly timeoutMs: number
  private readonly now: () => number

  constructor(private readonly config: PaymentsReadinessOptions) {
    const url = config.url
    if (!/^https:\/\//.test(url) && !/^http:\/\/localhost(?::\d+)?\//.test(url)) {
      throw new Error("Payments readiness requires HTTPS (localhost for isolated tests only)")
    }
    this.url = url
    this.timeoutMs = config.timeoutMs ?? 3000
    this.now = config.now ?? Date.now
  }

  async assertReadyForSeller(
    command: GovernedSellerOrderCommand,
    evidence: LegalSellerEvidence,
  ): Promise<void> {
    const bound = command as GovernedSellerOrderCommand & { tenantId?: string }
    if (
      !nonempty(bound.tenantId) ||
      !nonempty(command.organisationId) ||
      !nonempty(command.currencyCode) ||
      !nonempty(command.orderReference)
    ) {
      throw new Error("Payments readiness denied: no authoritative tenant or operation")
    }
    const request: PaymentsReadinessRequest = {
      tenant_id: bound.tenantId,
      organisation_id: command.organisationId,
      responsible_legal_entity_id: evidence.responsibleLegalEntityId,
      market: command.marketCode,
      currency_code: command.currencyCode,
      capability: command.legalCapability,
      operation_reference: command.orderReference,
      mandate_id: evidence.mandateId,
    }
    const token = await this.config.tokens.getAccessToken()
    if (!nonempty(token)) throw new Error("Payments readiness denied: no workload credential")
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-correlation-id": command.correlationId,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) throw new Error("Payments readiness denied: provider unavailable")
    const result: unknown = await response.json()
    assertCurrentPaymentsReadiness(result, request, this.now())
  }
}
