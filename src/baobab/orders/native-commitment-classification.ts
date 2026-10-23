/**
 * ADR-SHARED-042 section 14 Decision 8 (Shared trade/v2
 * native-commitment-classification; ADR-0034): Trade records, once per
 * native cart, draft order or order, whether the commitment is B2B or B2C.
 *
 * The model comes only from a current CP EstateCommerceProfile attestation
 * for the estate the commitment's CP-verified provenance names and the Market
 * of the CP context the resource's seller attribution was resolved under. The
 * provenance is either the CP estate client binding of a governed BFF request
 * (CAA-04) or, for a commitment that does not come through a BFF, the CP
 * governed resource assignment attestation (Decision 9). With neither there
 * is no classification: never a B2C or implicit fallback. Trade then checks
 * the model against the buyer relationship it established itself:
 *
 *   - B2B needs a current TradeBuyerExecutionContext for the same estate,
 *     Tenant, engine instance and estate binding. A consumer is never
 *     reinterpreted as B2B, nor a B2B commitment as B2C;
 *   - B2C needs a positively established consumer context, never the mere
 *     absence of a buyer Organisation.
 *
 * Nothing derives the model from a sales channel, domain, currency, customer
 * type or caller flag. A classification never changes: a different answer
 * for an already classified resource quarantines it (CLASSIFICATION_CHANGED)
 * until a governed replacement. The database repeats every rule
 * (Migration20261022210000). A classification is not authority: the commit
 * fence still requires the regime's receipts (Decision 6).
 */
import { randomUUID } from "node:crypto"
import type { TradeBuyerExecutionContext } from "../b2b/buyer-authority"
import { nativeCommitmentClassificationSchema } from "../contracts/authority-validation"
import {
  CommerceProfileError,
  type CommerceModel,
  type CommerceProfileAttestation,
  type CommerceProfileFailure,
  type CommerceProfileResolver,
  type EstateProvenance,
} from "../control-plane/estate-commerce-profile"
import type { ResourceAssignmentAttestation } from "../control-plane/estate-resource-assignment"
import type { CommitmentAttribution } from "./commitment-attribution"
import type { PgPool } from "./postgres-governed-binding-persistence"

/** trade/v2 classificationRefusal. */
export type ClassificationRefusal =
  | "CLASSIFICATION_ABSENT"
  | "PROFILE_NOT_ACTIVE"
  | "CLASSIFICATION_CONFLICT"
  | "CLASSIFICATION_CHANGED"
  | "PROFILE_UNAVAILABLE"
  | "BUYER_AUTHORITY_ABSENT"

/** The decisionReason each refusal maps to (native-commitment-classification.schema.json). */
export const CLASSIFICATION_DECISION_REASON = {
  CLASSIFICATION_ABSENT: "CONTEXT_NOT_USABLE",
  PROFILE_NOT_ACTIVE: "CONTEXT_NOT_USABLE",
  CLASSIFICATION_CONFLICT: "CONTEXT_NOT_USABLE",
  CLASSIFICATION_CHANGED: "CONTEXT_NOT_USABLE",
  PROFILE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  BUYER_AUTHORITY_ABSENT: "BUYER_NOT_AUTHORISED",
} as const satisfies Record<ClassificationRefusal, string>

export type ClassifiedResourceType = "cart" | "draft_order" | "order"

/** The wire NativeCommitmentClassification (trade/v2). */
export type NativeCommitmentClassification = {
  classification_id: string
  resource_type: ClassifiedResourceType
  resource_id: string
  origin: "DIRECT" | "CONVERTED" | "REPLACEMENT"
  lineage?: { parent_classification_id: string; relation: "CONVERTED_FROM" | "REPLACES" }
  digital_estate_id: string
  tenant_id: string
  trade_engine_instance_id: string
  market_id: string
  commerce_model: CommerceModel
  commerce_profile_id: string
  profile_revision: number
  profile_attestation_id: string
  seller_binding_reference: { binding_id: string; binding_version: number }
  buyer_account_model: "BUYER_ORGANISATION" | "CONSUMER"
  buyer_organisation_id?: string
  buyer_membership_id?: string
  consumer_reference?: string
  status: "ACTIVE" | "SUPERSEDED" | "QUARANTINED"
  revision: number
  classified_at: string
  evidence_references: string[]
}

export type ClassificationResult =
  | { outcome: "CLASSIFIED"; classification: NativeCommitmentClassification }
  | { outcome: "REFUSED"; reason: ClassificationRefusal }

/** The CAA-04 estate binding the buyer request carries. */
export type EstateBinding = {
  bindingId: string
  revision: number
  digitalEstateId: string
  tenantId: string
  engineInstanceId: string
  expiresAt: Date
}

/** The CP attestation that proved the commitment's Digital Estate. */
export type EstateProof =
  | ({ kind: "ESTATE_CLIENT_BINDING" } & EstateBinding)
  | { kind: "GOVERNED_RESOURCE_ASSIGNMENT"; assignment: ResourceAssignmentAttestation }

/** What every provenance proves, in one shape. */
type ProvenStatement = {
  provenance: EstateProvenance
  digitalEstateId: string
  tenantId: string
  engineInstanceId: string
  expiresAt: Date
  /** The Market the provenance is limited to, when it is. */
  marketId: string | null
  evidence: string[]
}

const proven = (estate: EstateProof | undefined): ProvenStatement | null => {
  if (estate?.kind === "ESTATE_CLIENT_BINDING") {
    return {
      provenance: { kind: estate.kind, reference: estate.bindingId },
      digitalEstateId: estate.digitalEstateId,
      tenantId: estate.tenantId,
      engineInstanceId: estate.engineInstanceId,
      expiresAt: estate.expiresAt,
      marketId: null,
      evidence: [`cp-estate-binding:${estate.bindingId}@r${estate.revision}`],
    }
  }
  if (estate?.kind === "GOVERNED_RESOURCE_ASSIGNMENT" && estate.assignment) {
    const a = estate.assignment
    return {
      provenance: { kind: estate.kind, reference: a.attestationId },
      digitalEstateId: a.digitalEstateId,
      tenantId: a.tenantId,
      engineInstanceId: a.engineInstanceId,
      expiresAt: a.expiresAt,
      marketId: a.marketId,
      evidence: [
        `cp-resource-assignment:${a.assignmentId}@r${a.assignmentRevision}`,
        `cp-resource-assignment-attestation:${a.attestationId}`,
      ],
    }
  }
  return null
}

export type ClassificationBuyer =
  | { model: "BUYER_ORGANISATION"; context: TradeBuyerExecutionContext }
  | { model: "CONSUMER"; consumerReference: string }

export type ClassifyRequest = {
  resource: { type: ClassifiedResourceType; id: string }
  /** The resource's current seller attribution (TA-04). */
  attribution: CommitmentAttribution
  /** The CP platform context that attribution was resolved under. */
  sellerContext: { contextId: string; marketId?: string }
  estate: EstateProof
  buyer: ClassificationBuyer
  correlationId: string
}

export type ProfileObservation = {
  digitalEstateId: string
  engineInstanceId: string
  marketId: string
  provenance: EstateProvenance
  correlationId: string
} & (
  | { outcome: "ATTESTED"; attestation: CommerceProfileAttestation }
  | { outcome: Exclude<CommerceProfileFailure, "CALLER_NOT_PERMITTED" | "RESOLUTION_UNAVAILABLE"> }
)

export type NewClassification = Omit<
  NativeCommitmentClassification,
  "status" | "revision" | "classified_at"
> & {
  attribution_id: string
  seller_context_id: string
  buyer_context_id: string | null
  correlation_id: string
}

export type StoredClassification =
  | { outcome: "CREATED" | "EXISTING"; classification: NativeCommitmentClassification }
  | { outcome: "CHANGED" }

export interface ClassificationStore {
  /** Append CP's answer; the database refuses a stale revision or a contradiction. */
  observe(observation: ProfileObservation): Promise<void>
  /**
   * Atomically classify the resource, or return its existing ACTIVE
   * classification if it says the same thing. A different answer
   * quarantines the existing one and reports CHANGED.
   */
  classify(row: NewClassification): Promise<StoredClassification>
}

export type ClassificationDependencies = {
  engineInstanceId: string
  profiles: CommerceProfileResolver | null
  store: ClassificationStore
  now?: () => number
  newId?: () => string
}

const RESOURCE = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,199}$/
const MARKET = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/

const refusal = (reason: ClassificationRefusal): ClassificationResult => ({
  outcome: "REFUSED",
  reason,
})

const CP_REFUSAL: Record<CommerceProfileFailure, ClassificationRefusal> = {
  PROFILE_NOT_REGISTERED: "CLASSIFICATION_ABSENT",
  ESTATE_PROVENANCE_INVALID: "CLASSIFICATION_ABSENT",
  PROFILE_NOT_ACTIVE: "PROFILE_NOT_ACTIVE",
  PROFILE_AMBIGUOUS: "CLASSIFICATION_CONFLICT",
  ENGINE_INSTANCE_NOT_PERMITTED: "CLASSIFICATION_CONFLICT",
  CALLER_NOT_PERMITTED: "PROFILE_UNAVAILABLE",
  RESOLUTION_UNAVAILABLE: "PROFILE_UNAVAILABLE",
}

export async function classifyNativeCommitment(
  deps: ClassificationDependencies,
  request: ClassifyRequest,
): Promise<ClassificationResult> {
  const now = (deps.now ?? Date.now)()
  const { resource, attribution, sellerContext, buyer } = request

  // The resource, its seller attribution and the CP context belong together
  // and to this Trade instance.
  if (
    !["cart", "draft_order", "order"].includes(resource?.type) ||
    !RESOURCE.test(resource?.id ?? "") ||
    attribution?.subject_type !== resource.type ||
    attribution.subject_id !== resource.id ||
    attribution.engine_instance_id !== deps.engineInstanceId ||
    sellerContext?.contextId !== attribution.context_id
  ) {
    return refusal("CLASSIFICATION_ABSENT")
  }
  // No canonical Market, no classification: Trade never mints a market_id.
  const marketId = sellerContext.marketId
  if (!marketId || !MARKET.test(marketId)) return refusal("CLASSIFICATION_ABSENT")
  // No CP-verified estate provenance, no classification.
  const estate = proven(request.estate)
  if (!estate) return refusal("CLASSIFICATION_ABSENT")
  if (
    estate.engineInstanceId !== deps.engineInstanceId ||
    estate.tenantId !== attribution.tenant_id ||
    (estate.marketId !== null && estate.marketId !== marketId) ||
    !(estate.expiresAt.getTime() > now)
  ) {
    return refusal("CLASSIFICATION_CONFLICT")
  }

  // The buyer relationship Trade established itself, for the same estate.
  if (buyer?.model === "BUYER_ORGANISATION") {
    const c = buyer.context
    if (
      !c ||
      c.digital_estate_id !== estate.digitalEstateId ||
      c.tenant_id !== estate.tenantId ||
      c.engine_instance_id !== deps.engineInstanceId ||
      // A buyer context established through a BFF names that BFF's binding.
      (estate.provenance.kind === "ESTATE_CLIENT_BINDING" &&
        !c.evidence_references.includes(estate.evidence[0])) ||
      !(Date.parse(c.expires_at) > now)
    ) {
      return refusal("CLASSIFICATION_CONFLICT")
    }
  } else if (buyer?.model !== "CONSUMER" || !buyer.consumerReference?.trim()) {
    return refusal("CLASSIFICATION_ABSENT")
  }

  if (!deps.profiles) return refusal("PROFILE_UNAVAILABLE")
  const scope = {
    digitalEstateId: estate.digitalEstateId,
    engineInstanceId: deps.engineInstanceId,
    marketId,
    provenance: estate.provenance,
    correlationId: request.correlationId,
  }
  let attestation: CommerceProfileAttestation
  try {
    attestation = await deps.profiles.resolve({
      digitalEstateId: estate.digitalEstateId,
      marketId,
      provenance: estate.provenance,
      correlationId: request.correlationId,
    })
  } catch (error) {
    const code = error instanceof CommerceProfileError ? error.code : "RESOLUTION_UNAVAILABLE"
    if (code !== "RESOLUTION_UNAVAILABLE" && code !== "CALLER_NOT_PERMITTED") {
      // CP's denial is evidence too; if it cannot be recorded the answer stands.
      await deps.store.observe({ ...scope, outcome: code }).catch(() => undefined)
    }
    return refusal(CP_REFUSAL[code])
  }
  try {
    await deps.store.observe({ ...scope, outcome: "ATTESTED", attestation })
  } catch {
    // A stale revision or a contradiction of an earlier attestation.
    return refusal("CLASSIFICATION_CONFLICT")
  }
  if (attestation.tenantId !== estate.tenantId) return refusal("CLASSIFICATION_CONFLICT")

  // CP and Trade must agree.
  if (attestation.commerceModel === "B2B" && buyer.model !== "BUYER_ORGANISATION") {
    return refusal("BUYER_AUTHORITY_ABSENT")
  }
  if (attestation.commerceModel === "B2C" && buyer.model !== "CONSUMER") {
    return refusal("CLASSIFICATION_CONFLICT")
  }

  const row: NewClassification = {
    classification_id: (deps.newId ?? randomUUID)(),
    resource_type: resource.type,
    resource_id: resource.id,
    origin: "DIRECT",
    digital_estate_id: estate.digitalEstateId,
    tenant_id: attestation.tenantId,
    trade_engine_instance_id: deps.engineInstanceId,
    market_id: marketId,
    commerce_model: attestation.commerceModel,
    commerce_profile_id: attestation.commerceProfileId,
    profile_revision: attestation.profileRevision,
    profile_attestation_id: attestation.attestationId,
    seller_binding_reference: {
      binding_id: attribution.binding_id,
      binding_version: attribution.binding_version,
    },
    buyer_account_model: buyer.model,
    ...(buyer.model === "BUYER_ORGANISATION"
      ? {
          buyer_organisation_id: buyer.context.buyer_organisation_id,
          buyer_membership_id: buyer.context.buyer_membership_id,
        }
      : { consumer_reference: buyer.consumerReference }),
    evidence_references: [
      `cp-commerce-profile:${attestation.commerceProfileId}@r${attestation.profileRevision}`,
      `cp-commerce-profile-attestation:${attestation.attestationId}`,
      ...estate.evidence,
      `trade-attribution:${attribution.attribution_id}`,
      ...(buyer.model === "BUYER_ORGANISATION"
        ? [`trade-buyer-context:${buyer.context.context_id}`]
        : []),
    ],
    attribution_id: attribution.attribution_id,
    seller_context_id: attribution.context_id,
    buyer_context_id: buyer.model === "BUYER_ORGANISATION" ? buyer.context.context_id : null,
    correlation_id: request.correlationId,
  }
  // The record must satisfy the Shared wire contract it claims to be.
  if (
    !nativeCommitmentClassificationSchema({
      ...wireFields(row),
      status: "ACTIVE",
      revision: 1,
      classified_at: new Date(now).toISOString(),
    })
  ) {
    return refusal("CLASSIFICATION_CONFLICT")
  }
  let stored: StoredClassification
  try {
    stored = await deps.store.classify(row)
  } catch {
    return refusal("PROFILE_UNAVAILABLE")
  }
  if (stored.outcome === "CHANGED") return refusal("CLASSIFICATION_CHANGED")
  return { outcome: "CLASSIFIED", classification: stored.classification }
}

/** Trade's persisted fields that are not part of the Shared wire record. */
const STORE_ONLY = ["attribution_id", "seller_context_id", "buyer_context_id", "correlation_id"]

/** The wire fields of a new classification, without Trade's store-only fields. */
export const wireFields = (
  row: NewClassification,
): Omit<NativeCommitmentClassification, "status" | "revision" | "classified_at"> =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !STORE_ONLY.includes(key))) as Omit<
    NativeCommitmentClassification,
    "status" | "revision" | "classified_at"
  >

const COLUMNS = `classification_id::text, resource_type, resource_id, origin, parent_classification_id::text,
  lineage_relation, digital_estate_id, tenant_id, trade_engine_instance_id, market_id, commerce_model,
  commerce_profile_id::text, profile_revision, profile_attestation_id::text, seller_binding_id::text,
  seller_binding_version, buyer_account_model, buyer_organisation_id, buyer_membership_id, consumer_reference,
  status, revision, classified_at, evidence_references`

const fromRow = (row: Record<string, unknown>): NativeCommitmentClassification => ({
  classification_id: String(row.classification_id),
  resource_type: row.resource_type as ClassifiedResourceType,
  resource_id: String(row.resource_id),
  origin: row.origin as NativeCommitmentClassification["origin"],
  ...(row.parent_classification_id
    ? {
        lineage: {
          parent_classification_id: String(row.parent_classification_id),
          relation: row.lineage_relation as "CONVERTED_FROM" | "REPLACES",
        },
      }
    : {}),
  digital_estate_id: String(row.digital_estate_id),
  tenant_id: String(row.tenant_id),
  trade_engine_instance_id: String(row.trade_engine_instance_id),
  market_id: String(row.market_id),
  commerce_model: row.commerce_model as CommerceModel,
  commerce_profile_id: String(row.commerce_profile_id),
  profile_revision: Number(row.profile_revision),
  profile_attestation_id: String(row.profile_attestation_id),
  seller_binding_reference: {
    binding_id: String(row.seller_binding_id),
    binding_version: Number(row.seller_binding_version),
  },
  buyer_account_model:
    row.buyer_account_model as NativeCommitmentClassification["buyer_account_model"],
  ...(row.buyer_organisation_id
    ? { buyer_organisation_id: String(row.buyer_organisation_id) }
    : {}),
  ...(row.buyer_membership_id ? { buyer_membership_id: String(row.buyer_membership_id) } : {}),
  ...(row.consumer_reference ? { consumer_reference: String(row.consumer_reference) } : {}),
  status: row.status as NativeCommitmentClassification["status"],
  revision: Number(row.revision),
  classified_at: new Date(row.classified_at as string).toISOString(),
  evidence_references: row.evidence_references as string[],
})

/** Whether an existing ACTIVE classification says exactly what the new answer says. */
const sameCommitment = (current: NativeCommitmentClassification, row: NewClassification) =>
  current.digital_estate_id === row.digital_estate_id &&
  current.tenant_id === row.tenant_id &&
  current.market_id === row.market_id &&
  current.commerce_model === row.commerce_model &&
  current.commerce_profile_id === row.commerce_profile_id &&
  current.seller_binding_reference.binding_id === row.seller_binding_reference.binding_id &&
  // Authority for one binding version is never authority for another.
  current.seller_binding_reference.binding_version ===
    row.seller_binding_reference.binding_version &&
  current.buyer_account_model === row.buyer_account_model &&
  current.buyer_organisation_id === row.buyer_organisation_id &&
  current.consumer_reference === row.consumer_reference

export class PostgresClassificationStore implements ClassificationStore {
  constructor(private readonly pool: PgPool) {}

  async observe(o: ProfileObservation): Promise<void> {
    const a = o.outcome === "ATTESTED" ? o.attestation : null
    const db = await this.pool.connect()
    try {
      await db.query(
        `INSERT INTO trade_commerce_profile_observation (digital_estate_id, engine_instance_id, market_id,
           estate_provenance_kind, estate_provenance_reference, outcome, attestation_id, commerce_profile_id,
           profile_revision, tenant_id, commerce_model, issued_at, expires_at, profile_effective_until,
           evidence_reference, correlation_id)
         VALUES ($1, $2, $3, $16, $4::uuid, $5, $6::uuid, $7::uuid, $8, $9, $10, $11, $12, $13, $14, $15::uuid)`,
        [
          o.digitalEstateId,
          o.engineInstanceId,
          o.marketId,
          o.provenance.reference,
          o.outcome,
          a?.attestationId ?? null,
          a?.commerceProfileId ?? null,
          a?.profileRevision ?? null,
          a?.tenantId ?? null,
          a?.commerceModel ?? null,
          a?.issuedAt ?? null,
          a?.expiresAt ?? null,
          a?.profileEffectiveUntil ?? null,
          a?.evidenceReference ?? null,
          o.correlationId,
          o.provenance.kind,
        ],
      )
    } finally {
      db.release()
    }
  }

  async classify(row: NewClassification): Promise<StoredClassification> {
    const db = await this.pool.connect()
    try {
      await db.query("BEGIN")
      await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `trade-classification/${row.resource_type}/${row.resource_id}`,
      ])
      const existing = await db.query(
        `SELECT ${COLUMNS} FROM trade_native_commitment_classification
          WHERE resource_type = $1 AND resource_id = $2
          ORDER BY classified_at DESC, classification_id DESC`,
        [row.resource_type, row.resource_id],
      )
      if (existing.rows.length > 0) {
        const active = existing.rows
          .map(fromRow)
          .find((classification) => classification.status === "ACTIVE")
        if (active && sameCommitment(active, row)) {
          await db.query("COMMIT")
          return { outcome: "EXISTING", classification: active }
        }
        // A classification never changes. A contradicting answer retires it
        // until a governed replacement; a retired resource stays retired.
        if (active) {
          await db.query(
            `UPDATE trade_native_commitment_classification SET status = 'QUARANTINED', revision = revision + 1
              WHERE classification_id = $1::uuid AND status = 'ACTIVE'`,
            [active.classification_id],
          )
        }
        await db.query("COMMIT")
        return { outcome: "CHANGED" }
      }
      const inserted = await db.query(
        `INSERT INTO trade_native_commitment_classification (classification_id, resource_type, resource_id,
           origin, digital_estate_id, tenant_id, trade_engine_instance_id, market_id, commerce_model,
           commerce_profile_id, profile_revision, profile_attestation_id, attribution_id, seller_binding_id,
           seller_binding_version, seller_context_id, buyer_account_model, buyer_organisation_id,
           buyer_membership_id, consumer_reference, buyer_context_id, status, revision, evidence_references,
           correlation_id)
         VALUES ($1::uuid, $2, $3, 'DIRECT', $4, $5, $6, $7, $8, $9::uuid, $10, $11::uuid, $12::uuid, $13::uuid,
                 $14, $15::uuid, $16, $17, $18, $19, $20::uuid, 'ACTIVE', 1, $21, $22::uuid)
         RETURNING ${COLUMNS}`,
        [
          row.classification_id,
          row.resource_type,
          row.resource_id,
          row.digital_estate_id,
          row.tenant_id,
          row.trade_engine_instance_id,
          row.market_id,
          row.commerce_model,
          row.commerce_profile_id,
          row.profile_revision,
          row.profile_attestation_id,
          row.attribution_id,
          row.seller_binding_reference.binding_id,
          row.seller_binding_reference.binding_version,
          row.seller_context_id,
          row.buyer_account_model,
          row.buyer_organisation_id ?? null,
          row.buyer_membership_id ?? null,
          row.consumer_reference ?? null,
          row.buyer_context_id,
          row.evidence_references,
          row.correlation_id,
        ],
      )
      await db.query("COMMIT")
      return { outcome: "CREATED", classification: fromRow(inserted.rows[0]) }
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      db.release()
    }
  }
}
