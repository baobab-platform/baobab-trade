/**
 * ADR-SHARED-039 Trade-0: Trade's workload attests its native seller
 * configuration to the CP-owned Seller Operating Binding registry
 * (POST /internal/trade/v1/seller-operating-bindings/attestations, scope
 * trade-seller-binding:attest) under its own RUNTIME context. CP takes the
 * tenant, Organisation and market from that context, never from Trade.
 *
 * An attestation authorises nothing: a binding exists only once humans in CP
 * propose, approve and activate a version that cites it.
 */
import {
  nativeConfigurationAttestationRequestSchema,
  nativeConfigurationAttestationSchema,
} from "../contracts/authority-validation"

export type NativeConfigurationAttestationRequest = {
  context_id: string
  engine_instance_id: string
  native_configuration_reference: string
  native_configuration_digest: string
  currency_scope: string[]
  attested_at: string
}

export type NativeConfigurationAttestation = {
  attestation_id: string
  tenant_id: string
  operating_organisation_id: string
  market: string
  engine_instance_id: string
  native_configuration_reference: string
  native_configuration_digest: string
  currency_scope: string[]
  attested_at: string
  recorded_at: string
}

/** The canonical side Trade expects CP to have derived from the context. */
export type ExpectedAttestationScope = {
  tenantId: string
  organisationId: string
  market: string
}

export interface SellerBindingAttestationPort {
  attest(
    request: NativeConfigurationAttestationRequest,
    expected: ExpectedAttestationScope,
    workloadAccessToken: string,
    correlationId: string,
  ): Promise<NativeConfigurationAttestation>
}

export const SELLER_BINDING_ATTESTATION_PATH =
  "/internal/trade/v1/seller-operating-bindings/attestations"

export class HttpSellerBindingAttestationClient implements SellerBindingAttestationPort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3000,
  ) {
    if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(baseUrl))
      throw new Error("CP seller-binding attestation requires HTTPS")
  }

  async attest(
    request: NativeConfigurationAttestationRequest,
    expected: ExpectedAttestationScope,
    workloadAccessToken: string,
    correlationId: string,
  ): Promise<NativeConfigurationAttestation> {
    if (
      !nativeConfigurationAttestationRequestSchema(request) ||
      !workloadAccessToken?.trim() ||
      !correlationId?.trim() ||
      !expected?.tenantId ||
      !expected.organisationId ||
      !expected.market
    ) {
      throw new Error("Invalid native-configuration attestation request")
    }
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}${SELLER_BINDING_ATTESTATION_PATH}`,
      {
        method: "POST",
        redirect: "error",
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
    if (response.status !== 201)
      throw new Error("Control Plane native-configuration attestation unavailable or refused")
    const payload: unknown = await response.json()
    if (!isAttestationFor(payload, request, expected)) {
      throw new Error("Invalid Control Plane native-configuration attestation: fail closed")
    }
    return payload
  }
}

/**
 * The recorded attestation must be exactly what Trade sent, under exactly
 * the tenant, Organisation and market Trade resolved its context for.
 */
export function isAttestationFor(
  value: unknown,
  request: NativeConfigurationAttestationRequest,
  expected: ExpectedAttestationScope,
): value is NativeConfigurationAttestation {
  if (!nativeConfigurationAttestationSchema(value)) return false
  const a = value as NativeConfigurationAttestation
  const sameSet = (x: string[], y: string[]) =>
    x.length === y.length && [...x].sort().join(",") === [...y].sort().join(",")
  return (
    a.tenant_id === expected.tenantId &&
    a.operating_organisation_id === expected.organisationId &&
    a.market === expected.market &&
    a.engine_instance_id === request.engine_instance_id &&
    a.native_configuration_reference === request.native_configuration_reference &&
    a.native_configuration_digest === request.native_configuration_digest &&
    sameSet(a.currency_scope, request.currency_scope) &&
    Date.parse(a.attested_at) === Date.parse(request.attested_at)
  )
}
