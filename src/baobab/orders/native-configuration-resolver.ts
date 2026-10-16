/**
 * ADR-SHARED-039 Trade-A TA-03: Trade remains authoritative for mapping its
 * native carts, drafts and orders to an attested native configuration. Given
 * the server-read sales channel, region and currency of ONE native record,
 * this resolver finds exactly one of Trade's own attested configurations that
 * covers it, then recomputes that configuration's CURRENT digest from live
 * Medusa records. The result is what Trade sends to CP binding discovery and
 * order authority; it selects no seller, legal entity or binding itself.
 *
 * Zero or several covering configurations deny, and so does live drift in any
 * digested attribute (a disabled channel, a region's currency or countries):
 * Trade never silently re-attests. A digest CP has not attested under the
 * binding is denied there with NATIVE_CONFIGURATION_MISMATCH.
 */
import {
  currentNativeSellerConfiguration,
  NATIVE_CONFIGURATION_CANONICALIZATION,
  type NativeSellerConfigurationScope,
  type NativeSellerFactsReader,
} from "./native-seller-configuration"
import type { PgPool } from "./postgres-governed-binding-persistence"

/** Server-read native facts of the cart, draft or order; never request input. */
export type NativeCommitmentScope = {
  salesChannelId: string
  regionId: string
  currency: string
}

export type ResolvedNativeConfiguration = {
  reference: string
  digest: string
  currency: string
  tenantId: string
  organisationId: string
  market: string
  engineInstanceId: string
  attestationId: string
}

/** One attested configuration as Trade recorded it (latest per reference). */
export type AttestedNativeConfiguration = {
  attestation_id: string
  native_configuration_reference: string
  canonical_configuration: string
}

export interface AttestedNativeConfigurationReader {
  latestForEngine(engineInstanceId: string): Promise<AttestedNativeConfiguration[]>
}

type CanonicalDocument = {
  canonicalization: string
  tenant_id: string
  operating_organisation_id: string
  market: string
  engine_instance_id: string
  native_configuration_reference: string
  currency_scope: string[]
  sales_channels: { id: string }[]
  regions: { id: string; currency_code: string }[]
}

const deny = (reason: string): never => {
  throw new Error(`Native configuration resolution denied: ${reason}`)
}

function parseCanonical(
  a: AttestedNativeConfiguration,
  engineInstanceId: string,
): CanonicalDocument {
  let doc: CanonicalDocument
  try {
    doc = JSON.parse(a.canonical_configuration) as CanonicalDocument
  } catch {
    return deny(`attestation ${a.attestation_id} is not a canonical document`)
  }
  if (
    doc?.canonicalization !== NATIVE_CONFIGURATION_CANONICALIZATION ||
    doc.native_configuration_reference !== a.native_configuration_reference ||
    doc.engine_instance_id !== engineInstanceId ||
    !Array.isArray(doc.sales_channels) ||
    !Array.isArray(doc.regions) ||
    !Array.isArray(doc.currency_scope)
  ) {
    deny(`attestation ${a.attestation_id} is not a canonical v1 document for this engine`)
  }
  return doc
}

export async function resolveNativeConfiguration(
  native: NativeCommitmentScope,
  engineInstanceId: string,
  attested: AttestedNativeConfigurationReader,
  facts: NativeSellerFactsReader,
): Promise<ResolvedNativeConfiguration> {
  if (!native?.salesChannelId?.trim() || !native.regionId?.trim())
    deny("native channel and region required")
  const currency = String(native.currency ?? "").toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) deny("native currency required")
  if (!/^ei_[a-z0-9]+$/.test(engineInstanceId ?? "")) deny("engine instance required")
  if (!attested || !facts) deny("trusted readers unavailable")

  const covering = (await attested.latestForEngine(engineInstanceId))
    .map((a) => ({ a, doc: parseCanonical(a, engineInstanceId) }))
    .filter(
      ({ doc }) =>
        doc.sales_channels.some((c) => c.id === native.salesChannelId) &&
        doc.regions.some((r) => r.id === native.regionId && r.currency_code === currency) &&
        doc.currency_scope.includes(currency),
    )
  if (covering.length === 0) deny("no attested native configuration covers this record")
  if (covering.length > 1) deny("several attested native configurations cover this record")
  const { a, doc } = covering[0]

  // Recompute from LIVE records under the attested scope; drift changes the digest.
  const scope: NativeSellerConfigurationScope = {
    reference: doc.native_configuration_reference,
    tenantId: doc.tenant_id,
    organisationId: doc.operating_organisation_id,
    market: doc.market,
    engineInstanceId: doc.engine_instance_id,
    currencyScope: doc.currency_scope,
    salesChannelIds: doc.sales_channels.map((c) => c.id),
    regionIds: doc.regions.map((r) => r.id),
  }
  const current = await currentNativeSellerConfiguration(scope, facts)
  return {
    reference: current.reference,
    digest: current.digest,
    currency,
    tenantId: doc.tenant_id,
    organisationId: doc.operating_organisation_id,
    market: doc.market,
    engineInstanceId: doc.engine_instance_id,
    attestationId: a.attestation_id,
  }
}

/** Reads Trade's own append-only attestation record, latest per reference. */
export class PostgresAttestedNativeConfigurationReader implements AttestedNativeConfigurationReader {
  constructor(private readonly pool: PgPool) {}

  async latestForEngine(engineInstanceId: string): Promise<AttestedNativeConfiguration[]> {
    const db = await this.pool.connect()
    try {
      const result = await db.query(
        `SELECT DISTINCT ON (native_configuration_reference)
                attestation_id::text, native_configuration_reference, canonical_configuration
           FROM trade_native_configuration_attestation
          WHERE engine_instance_id = $1
          ORDER BY native_configuration_reference, recorded_at DESC, attestation_id DESC`,
        [engineInstanceId],
      )
      return result.rows.map((row) => ({
        attestation_id: String(row.attestation_id),
        native_configuration_reference: String(row.native_configuration_reference),
        canonical_configuration: String(row.canonical_configuration),
      }))
    } finally {
      db.release()
    }
  }
}
