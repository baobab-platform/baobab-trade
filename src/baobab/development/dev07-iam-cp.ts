/**
 * DEV-07 live identity qualifier protocol. Only actual issuer/CP transports
 * belong in the runner. Test doubles exercise the refusal contract in unit
 * tests and are never runtime acceptance evidence.
 */
export const DEV07_IDENTITY_CASES = [
  "issuer-issuance-and-independent-readback",
  "cp-principal-estate-organisation-market",
  "native-buyer-context",
  "wrong-company-denial",
  "wrong-audience-denial",
  "membership-suspension-denial",
  "issuer-revocation-before-expiry",
  "owned-buyer-bff-native-cleanup",
] as const
export type IdentityCase = (typeof DEV07_IDENTITY_CASES)[number]
export type IdentityReason =
  | "OBSERVED"
  | "NOT_EXECUTED"
  | "AUTHORITY_NOT_CONFIGURED"
  | "DEPENDENCY_UNAVAILABLE"
  | "ASSERTION_FAILED"
  | "CLEANUP_FAILED"
export class IdentityQualificationError extends Error {
  constructor(readonly reason: Exclude<IdentityReason, "OBSERVED" | "NOT_EXECUTED">) {
    super(reason)
  }
}

export function identityReport(source: string) {
  if (!/^[0-9a-f]{40}$/.test(source)) throw new IdentityQualificationError("ASSERTION_FAILED")
  return {
    schema: "baobab-trade.dev07-iam-cp-components.v1",
    source_sha: source,
    evidence_class: "NOT_OBSERVED" as "NOT_OBSERVED" | "REAL_COMPONENT_SYNTHETIC_DATA",
    scope: "LIVE_IAM_CP_NATIVE_TRADE_HANDLER",
    iam_cp_component_qualified: false,
    // The driver cannot witness host/network/store disposal or BFF routing.
    host_teardown: "NOT_OBSERVED",
    bff_http_qualified: false,
    int05_qualified: false,
    provider_qualified: false,
    protected_acceptance: false,
    production_authorized: false,
    cases: Object.fromEntries(
      DEV07_IDENTITY_CASES.map((name) => [
        name,
        {
          result: "BLOCKED" as "PASS" | "FAIL" | "BLOCKED",
          reason: "NOT_EXECUTED" as IdentityReason,
        },
      ]),
    ),
  }
}
export type IdentityReport = ReturnType<typeof identityReport>

/** A bare active=true is insufficient: bind readback to verified signed claims. */
export function issuerReadbackMatches(
  body: unknown,
  token: { subject: string; clientId: string; expiresAt: Date },
  issuer: string,
  audience: string,
  scope: string,
  now: number,
): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false
  const v = body as Record<string, unknown>
  const aud = typeof v.aud === "string" ? [v.aud] : v.aud
  return (
    v.active === true &&
    v.iss === issuer &&
    v.sub === token.subject &&
    v.client_id === token.clientId &&
    Array.isArray(aud) &&
    aud.length === 1 &&
    aud[0] === audience &&
    typeof v.scope === "string" &&
    v.scope.split(" ").includes(scope) &&
    typeof v.exp === "number" &&
    Number.isInteger(v.exp) &&
    v.exp * 1000 === token.expiresAt.getTime() &&
    Number.isFinite(now) &&
    now < token.expiresAt.getTime()
  )
}

/** Qualification configuration is data, never a source of bearer authority. */
export function developmentEndpoint(value: unknown): URL {
  if (typeof value !== "string") throw new IdentityQualificationError("AUTHORITY_NOT_CONFIGURED")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new IdentityQualificationError("AUTHORITY_NOT_CONFIGURED")
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !(url.hostname.endsWith(".test") || url.hostname === "localhost")
  ) {
    throw new IdentityQualificationError("AUTHORITY_NOT_CONFIGURED")
  }
  return url
}

/** Closed diagnostic only: never serialize a handler body or credential. */
export function nativeContextDiagnostic(status: number, body: Record<string, unknown>): string {
  const statuses = [200, 400, 401, 403, 404, 409, 503]
  const reasons = [
    "BUYER_TOKEN_INVALID",
    "ASSURANCE_INSUFFICIENT",
    "IDENTITY_NOT_RESOLVED",
    "PRINCIPAL_NOT_ACTIVE",
    "BUYER_NOT_AUTHORISED",
    "ORGANISATION_NOT_ATTESTED",
    "ROLE_NOT_PERMITTED",
    "MARKET_NOT_PERMITTED",
    "CONTEXT_NOT_USABLE",
    "OPERATION_NOT_ACTIVATED",
    "SOURCE_UNAVAILABLE",
  ]
  const decision = body.decision
  const values =
    typeof decision === "object" && decision !== null && "reasons" in decision
      ? decision.reasons
      : undefined
  const reason = Array.isArray(values) && values.length === 1 ? values[0] : undefined
  return `DEV07_NATIVE_CONTEXT=HTTP_${statuses.includes(status) ? status : "OTHER"}_REASON_${
    status === 200 ? "CONTEXT_MISMATCH" : reasons.includes(reason) ? reason : "OTHER"
  }`
}
