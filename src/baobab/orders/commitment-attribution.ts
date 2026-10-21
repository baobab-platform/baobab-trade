/**
 * ADR-SHARED-039 Trade-A TA-04: attribute one native cart, draft order or
 * order to exactly one CP Seller Operating Binding version.
 *
 * Trade derives the record's attested native configuration and live digest
 * (TA-03), asks CP for the single ACTIVE binding version under a fresh
 * RUNTIME context of that configuration's tenant, Organisation and market,
 * and records the answer as PROVISIONAL attribution. It works for every entry
 * point alike (cart checkout, direct, admin, draft, background) because it
 * needs only the record's server-read channel, region and currency.
 *
 * An attribution is never authority: each consequential operation still
 * obtains its own order-authority decision for the attributed version (TA-05).
 * A record whose binding resolves to a DIFFERENT seller binding is denied, not
 * re-attributed; the database refuses it too.
 */
import { randomUUID } from "node:crypto"
import type { ControlPlaneClient } from "../control-plane/client"
import type {
  BindingResolution,
  TradeOrderAuthorityPort,
} from "../control-plane/trade-order-authority"
import type { WorkloadTokenProvider } from "../control-plane/workload-token"
import {
  resolveNativeConfiguration,
  type AttestedNativeConfigurationReader,
  type NativeCommitmentScope,
  type ResolvedNativeConfiguration,
} from "./native-configuration-resolver"
import type { NativeSellerFactsReader } from "./native-seller-configuration"
import type { PgPool } from "./postgres-governed-binding-persistence"

export type CommitmentSubjectType = "cart" | "draft_order" | "order"
export type CommitmentSubject = { type: CommitmentSubjectType; id: string }

export type CommitmentAttribution = {
  attribution_id: string
  subject_type: CommitmentSubjectType
  subject_id: string
  attestation_id: string
  native_configuration_reference: string
  native_configuration_digest: string
  currency: string
  tenant_id: string
  operating_organisation_id: string
  market: string
  engine_instance_id: string
  binding_id: string
  binding_version: number
  resolution_id: string
  context_id: string
  resolved_at: string
  correlation_id: string
}

export interface CommitmentAttributionStore {
  /** Latest attribution of the record, or null. */
  current(subject: CommitmentSubject): Promise<CommitmentAttribution | null>
  /** Append-only; the database re-checks configuration and seller continuity. */
  record(attribution: Omit<CommitmentAttribution, "attribution_id">): Promise<CommitmentAttribution>
}

export type CommitmentAttributionDependencies = {
  engineInstanceId: string
  attested: AttestedNativeConfigurationReader
  facts: NativeSellerFactsReader
  controlPlane: Pick<ControlPlaneClient, "resolvePlatformContext">
  authority: Pick<TradeOrderAuthorityPort, "resolveBinding">
  tokens: WorkloadTokenProvider
  store: CommitmentAttributionStore
  now?: () => number
}

/** A denial that names the CP or Trade outcome, so callers can map it to RFC 9457. */
export class CommitmentAttributionDenied extends Error {
  constructor(
    readonly outcome: string,
    message: string,
  ) {
    super(`Trade-A attribution denied (${outcome}): ${message}`)
  }
}

export type AttributedCommitment = {
  attribution: CommitmentAttribution
  configuration: ResolvedNativeConfiguration
  /** The RUNTIME context the binding was resolved under; reused only while current. */
  context: { contextId: string; expiresAt: number }
}

const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/

export async function attributeCommitment(
  subject: CommitmentSubject,
  native: NativeCommitmentScope,
  deps: CommitmentAttributionDependencies,
): Promise<AttributedCommitment> {
  if (
    !subject ||
    !["cart", "draft_order", "order"].includes(subject.type) ||
    !SUBJECT.test(subject.id ?? "")
  )
    throw new CommitmentAttributionDenied(
      "INVALID_SUBJECT",
      "a server-side native record is required",
    )
  if (
    !deps?.attested ||
    !deps.facts ||
    !deps.controlPlane ||
    !deps.authority ||
    !deps.tokens ||
    !deps.store
  )
    throw new CommitmentAttributionDenied(
      "UNAVAILABLE",
      "required trusted dependencies unavailable",
    )
  const now = deps.now ?? Date.now

  let configuration: ResolvedNativeConfiguration
  try {
    configuration = await resolveNativeConfiguration(
      native,
      deps.engineInstanceId,
      deps.attested,
      deps.facts,
    )
  } catch (error) {
    throw new CommitmentAttributionDenied(
      "NATIVE_CONFIGURATION_UNRESOLVED",
      (error as Error).message,
    )
  }

  const token = await deps.tokens.getAccessToken()
  // Shared control-plane/v1: X-Correlation-ID is a bare UUID; CP refuses anything else.
  const correlationId = randomUUID()
  const context = await deps.controlPlane.resolvePlatformContext(
    configuration.tenantId,
    configuration.organisationId,
    token,
    correlationId,
    // ADR-BCP-024 exact-kind attestation: the seller's operating Organisation.
    "ORGANISATION",
    configuration.market,
  )
  const expiresAt = context.expires_at ? Date.parse(context.expires_at) : Number.NaN
  if (
    context.tenant_id !== configuration.tenantId ||
    context.organisation_id !== configuration.organisationId ||
    context.organisation_type !== "ORGANISATION" ||
    context.country_code !== configuration.market ||
    !(expiresAt > now())
  ) {
    throw new CommitmentAttributionDenied(
      "CONTEXT_NOT_USABLE",
      "CP context does not match the attested configuration",
    )
  }

  const resolution: BindingResolution = await deps.authority.resolveBinding(
    {
      context_id: context.context_id,
      engine_instance_id: configuration.engineInstanceId,
      native_configuration_reference: configuration.reference,
      native_configuration_digest: configuration.digest,
      currency: configuration.currency,
    },
    token,
    correlationId,
  )
  if (resolution.outcome !== "RESOLVED" || !resolution.binding_reference)
    throw new CommitmentAttributionDenied(
      resolution.outcome,
      "CP resolved no single ACTIVE binding",
    )

  const prior = await deps.store.current(subject)
  if (prior && prior.binding_id !== resolution.binding_reference.binding_id) {
    // Never silently substitute a different seller; the database refuses it as well.
    throw new CommitmentAttributionDenied(
      "SELLER_CHANGED",
      "the record's seller binding changed; re-evaluation required",
    )
  }
  const attribution = await deps.store.record({
    subject_type: subject.type,
    subject_id: subject.id,
    attestation_id: configuration.attestationId,
    native_configuration_reference: configuration.reference,
    native_configuration_digest: configuration.digest,
    currency: configuration.currency,
    tenant_id: configuration.tenantId,
    operating_organisation_id: configuration.organisationId,
    market: configuration.market,
    engine_instance_id: configuration.engineInstanceId,
    binding_id: resolution.binding_reference.binding_id,
    binding_version: resolution.binding_reference.binding_version,
    resolution_id: resolution.resolution_id,
    context_id: context.context_id,
    resolved_at: resolution.resolved_at,
    correlation_id: correlationId,
  })
  return { attribution, configuration, context: { contextId: context.context_id, expiresAt } }
}

const COLUMNS = `attribution_id::text, subject_type, subject_id, attestation_id::text, native_configuration_reference,
  native_configuration_digest, currency, tenant_id, operating_organisation_id::text, market, engine_instance_id,
  binding_id::text, binding_version, resolution_id::text, context_id::text, resolved_at, correlation_id`

const fromRow = (row: Record<string, unknown>): CommitmentAttribution => ({
  attribution_id: String(row.attribution_id),
  subject_type: row.subject_type as CommitmentSubjectType,
  subject_id: String(row.subject_id),
  attestation_id: String(row.attestation_id),
  native_configuration_reference: String(row.native_configuration_reference),
  native_configuration_digest: String(row.native_configuration_digest),
  currency: String(row.currency),
  tenant_id: String(row.tenant_id),
  operating_organisation_id: String(row.operating_organisation_id),
  market: String(row.market),
  engine_instance_id: String(row.engine_instance_id),
  binding_id: String(row.binding_id),
  binding_version: Number(row.binding_version),
  resolution_id: String(row.resolution_id),
  context_id: String(row.context_id),
  resolved_at: new Date(row.resolved_at as string).toISOString(),
  correlation_id: String(row.correlation_id),
})

export class PostgresCommitmentAttributionStore implements CommitmentAttributionStore {
  constructor(private readonly pool: PgPool) {}

  async current(subject: CommitmentSubject): Promise<CommitmentAttribution | null> {
    const db = await this.pool.connect()
    try {
      const result = await db.query(
        `SELECT ${COLUMNS} FROM trade_commitment_attribution
          WHERE subject_type = $1 AND subject_id = $2
          ORDER BY recorded_at DESC, attribution_id DESC LIMIT 1`,
        [subject.type, subject.id],
      )
      return result.rows[0] ? fromRow(result.rows[0]) : null
    } finally {
      db.release()
    }
  }

  async record(a: Omit<CommitmentAttribution, "attribution_id">): Promise<CommitmentAttribution> {
    const db = await this.pool.connect()
    try {
      const result = await db.query(
        `INSERT INTO trade_commitment_attribution (
           subject_type, subject_id, attestation_id, native_configuration_reference, native_configuration_digest,
           currency, tenant_id, operating_organisation_id, market, engine_instance_id, binding_id, binding_version,
           resolution_id, context_id, resolved_at, correlation_id)
         VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::uuid, $9, $10, $11::uuid, $12, $13::uuid, $14::uuid, $15, $16)
         RETURNING ${COLUMNS}`,
        [
          a.subject_type,
          a.subject_id,
          a.attestation_id,
          a.native_configuration_reference,
          a.native_configuration_digest,
          a.currency,
          a.tenant_id,
          a.operating_organisation_id,
          a.market,
          a.engine_instance_id,
          a.binding_id,
          a.binding_version,
          a.resolution_id,
          a.context_id,
          a.resolved_at,
          a.correlation_id,
        ],
      )
      if (result.rowCount !== 1) throw new Error("Commitment attribution was not recorded")
      return fromRow(result.rows[0])
    } finally {
      db.release()
    }
  }
}
