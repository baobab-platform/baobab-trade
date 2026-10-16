/**
 * ADR-SHARED-039 Trade-0: attest Trade's CURRENT native seller configuration
 * to CP under a freshly resolved RUNTIME context, then keep Trade's own
 * append-only evidence of what CP accepted. Nothing here creates, approves or
 * activates a binding: that is CP's human-governed lifecycle.
 */
import { randomUUID } from "node:crypto"
import type { ControlPlaneClient } from "../control-plane/client"
import type {
  NativeConfigurationAttestation,
  SellerBindingAttestationPort,
} from "../control-plane/seller-binding-attestation"
import type { WorkloadTokenProvider } from "../control-plane/workload-token"
import {
  currentNativeSellerConfiguration,
  type NativeSellerConfigurationScope,
  type NativeSellerFactsReader,
} from "./native-seller-configuration"
import { resolveNativeCheckoutEnvironment } from "./native-cart-legal-seller"
import type { PgPool } from "./postgres-governed-binding-persistence"

export type RecordedNativeConfigurationAttestation = NativeConfigurationAttestation & {
  canonical_configuration: string
  context_id: string
  correlation_id: string
}

export interface NativeConfigurationAttestationStore {
  record(attestation: RecordedNativeConfigurationAttestation): Promise<void>
}

export type NativeConfigurationAttestationDependencies = {
  facts: NativeSellerFactsReader
  controlPlane: Pick<ControlPlaneClient, "resolvePlatformContext">
  attestations: SellerBindingAttestationPort
  tokens: WorkloadTokenProvider
  store: NativeConfigurationAttestationStore
  environment: { node?: string; baobab?: string; deployment?: string; enabled?: string }
  now?: () => number
}

const deny = (reason: string): never => {
  throw new Error(`Native-configuration attestation denied: ${reason}`)
}

export async function attestNativeSellerConfiguration(
  scope: NativeSellerConfigurationScope,
  deps: NativeConfigurationAttestationDependencies,
): Promise<RecordedNativeConfigurationAttestation> {
  const profile = resolveNativeCheckoutEnvironment(deps?.environment ?? {})
  // Explicit, non-production opt-in. Production and unknown profiles stay closed.
  if (deps?.environment?.enabled !== "true" || profile.production)
    deny("explicit non-production enablement required")
  if (!deps.facts || !deps.controlPlane || !deps.attestations || !deps.tokens || !deps.store)
    deny("required trusted dependencies unavailable")
  const now = deps.now ?? Date.now

  // The digest is computed from live native records immediately before
  // submission; a stale or remembered digest is never attested.
  const configuration = await currentNativeSellerConfiguration(scope, deps.facts)
  const token = await deps.tokens.getAccessToken()
  const correlationId = `trade-attestation/${randomUUID()}`

  // CP derives tenant, Organisation and market from this RUNTIME context.
  const context = await deps.controlPlane.resolvePlatformContext(
    scope.tenantId,
    scope.organisationId,
    token,
    correlationId,
    undefined,
    scope.market,
  )
  const expires = context.expires_at ? Date.parse(context.expires_at) : Number.NaN
  if (
    context.tenant_id !== scope.tenantId ||
    context.organisation_id !== scope.organisationId ||
    context.country_code !== scope.market ||
    !(expires > now())
  ) {
    deny("CP context does not match the declared seller operating context")
  }

  const request = {
    context_id: context.context_id,
    engine_instance_id: scope.engineInstanceId,
    native_configuration_reference: configuration.reference,
    native_configuration_digest: configuration.digest,
    currency_scope: configuration.currencyScope,
    attested_at: new Date(now()).toISOString(),
  }
  const accepted = await deps.attestations.attest(
    request,
    { tenantId: scope.tenantId, organisationId: scope.organisationId, market: scope.market },
    token,
    correlationId,
  )
  const recorded: RecordedNativeConfigurationAttestation = {
    ...accepted,
    canonical_configuration: configuration.canonical,
    context_id: context.context_id,
    correlation_id: correlationId,
  }
  await deps.store.record(recorded)
  return recorded
}

/** Append-only; the database recomputes the digest and refuses rewrites. */
export class PostgresNativeConfigurationAttestationStore implements NativeConfigurationAttestationStore {
  constructor(private readonly pool: PgPool) {}

  async record(a: RecordedNativeConfigurationAttestation): Promise<void> {
    const db = await this.pool.connect()
    try {
      const result = await db.query(
        `INSERT INTO trade_native_configuration_attestation (
           attestation_id, native_configuration_reference, native_configuration_digest,
           canonical_configuration, tenant_id, operating_organisation_id, market,
           engine_instance_id, currency_scope, context_id, attested_at, cp_recorded_at,
           correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10, $11, $12, $13)`,
        [
          a.attestation_id,
          a.native_configuration_reference,
          a.native_configuration_digest,
          a.canonical_configuration,
          a.tenant_id,
          a.operating_organisation_id,
          a.market,
          a.engine_instance_id,
          // Canonical (sorted) order: the database binds it to the digested document.
          [...a.currency_scope].sort(),
          a.context_id,
          a.attested_at,
          a.recorded_at,
          a.correlation_id,
        ],
      )
      if (result.rowCount !== 1)
        throw new Error("Native-configuration attestation was not recorded")
    } finally {
      db.release()
    }
  }
}
