import { createHash } from "node:crypto"
import {
  bindingAuthorizationRequestSchema,
  bindingAuthorizationResponseSchema,
  legalActorRequestSchema,
  legalActorResponseSchema,
} from "../contracts/authority-validation"
import {
  isValidPlatformContextResolutionResponse,
  type RawPlatformContextResolutionResponse,
} from "../contracts/platform-context"
import type { GovernedBindingScope } from "./governed-binding-command-policy"
import type { LegalActorDecision, LegalActorRequest } from "../control-plane/legal-actor-assessment"

export type BindingOperation = "propose" | "approve" | "activate" | "revoke"
export type BindingAdmission = {
  scope: GovernedBindingScope
  command_digest: string
  decision_id: string
  principal_id: string
  issuer: string
  token_id: string
  scope_name: string
  evaluated_at: string
  valid_until: string
  matched_grant_ids: string[]
  provider_permissions_granted: false
}
/** Stable field ordering, including original stored proposal and revision. */
export function bindingCommandDigest(command: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, canonical(v)]),
      )
    return value
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(command)))
    .digest("hex")
}
export function assertBindingAdmission(
  value: BindingAdmission,
  operation: BindingOperation,
  scope: GovernedBindingScope,
  digest: string,
  now: number,
): void {
  if (
    !bindingAuthorizationResponseSchema(value) ||
    value.scope_name !== `trade-binding:${operation}` ||
    value.command_digest !== digest ||
    bindingCommandDigest(value.scope) !== bindingCommandDigest(scope) ||
    Date.parse(value.evaluated_at) > now ||
    Date.parse(value.evaluated_at) < now - 5000 ||
    Date.parse(value.valid_until) <= now ||
    Date.parse(value.valid_until) > Date.parse(value.evaluated_at) + 5000
  ) {
    throw new Error("Binding command admission denied")
  }
}
export interface BindingAuthorityClient {
  authorize(
    token: string,
    operation: BindingOperation,
    scope: GovernedBindingScope,
    digest: string,
  ): Promise<BindingAdmission>
  resolve(
    scope: GovernedBindingScope,
    workloadToken: string,
  ): Promise<RawPlatformContextResolutionResponse>
  assess(request: LegalActorRequest, workloadToken: string): Promise<LegalActorDecision>
}
/** All authority is obtained directly from fixed CP routes, never from body
 * receipts or configured candidate IAM/evidence gateways. No redirects, bounded
 * decoded bytes and timeout through completion of the response body. */
export class HttpBindingAuthorityClient implements BindingAuthorityClient {
  private readonly base: string
  constructor(base: string) {
    const url = new URL(base)
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("Binding authority requires a trusted HTTPS CP origin")
    this.base = url.origin
  }
  private async post(path: string, token: string, body: unknown): Promise<unknown> {
    if (!token.trim() || token.length > 16384 || /\s/.test(token))
      throw new Error("Human or workload credential required")
    const response = await fetch(this.base + path, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-correlation-id": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    })
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get("content-type")?.startsWith("application/json")
    )
      throw new Error("Binding authority unavailable or denied")
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 65536) throw new Error("Binding authority response too large")
        chunks.push(value)
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }
  async authorize(
    token: string,
    operation: BindingOperation,
    scope: GovernedBindingScope,
    digest: string,
  ): Promise<BindingAdmission> {
    const request = { scope, command_digest: digest }
    if (!bindingAuthorizationRequestSchema(request))
      throw new Error("Invalid binding command scope")
    const result = await this.post(
      `/internal/trade-binding/v1/${operation}/authorize`,
      token,
      request,
    )
    if (!bindingAuthorizationResponseSchema(result)) throw new Error("Invalid CP binding admission")
    assertBindingAdmission(result as BindingAdmission, operation, scope, digest, Date.now())
    return result as BindingAdmission
  }
  async resolve(
    scope: GovernedBindingScope,
    workloadToken: string,
  ): Promise<RawPlatformContextResolutionResponse> {
    const result = await this.post("/v1/platform-context/resolve", workloadToken, {
      tenant_id: scope.tenantId,
      organisation_id: scope.organisationId,
      country_code: scope.marketCode,
      expected_organisation_type: "ORGANISATION",
    })
    if (!isValidPlatformContextResolutionResponse(result))
      throw new Error("Invalid CP runtime context")
    return result
  }
  async assess(request: LegalActorRequest, workloadToken: string): Promise<LegalActorDecision> {
    if (!legalActorRequestSchema(request)) throw new Error("Invalid seller assessment request")
    const result = await this.post("/internal/legal-actor/v1/assess", workloadToken, request)
    if (!legalActorResponseSchema(result)) throw new Error("Invalid CP legal actor response")
    return result as LegalActorDecision
  }
}
