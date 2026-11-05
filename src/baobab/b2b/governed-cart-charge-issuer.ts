import { createHash, verify } from "node:crypto"
import type { KeyObject } from "node:crypto"
import type { PgPool } from "../orders/postgres-governed-binding-persistence"

/** The 7 necessary governed price components. Absence is never zero. */
export const REQUIRED_CHARGES = [
  "TAX",
  "FREIGHT",
  "DUTY",
  "HANDLING",
  "INSURANCE",
  "SERVICE_CHARGE",
  "REFUNDABLE_DEPOSIT",
] as const
type Charge = (typeof REQUIRED_CHARGES)[number]
type Resolution = "CHARGED" | "ZERO_RATED" | "EXEMPT" | "NOT_APPLICABLE"
type ZeroReason = "ZERO_RATE_AUTHORISED" | "EXEMPTION_DOCUMENTED" | "NOT_APPLICABLE_PER_INCOTERM"
type Item = {
  kind: Charge
  resolution: Resolution
  /** Exact unsigned integer minor-units string; no floating point. */
  amountMinor: string
  sourceReference: string
  /** Explicit governed rationale, even when no charge applies. */
  zeroReason: ZeroReason | null
}
export type ChargeEvidence = {
  issuerId: string
  attestationId: string
  tenantId: string
  cartId: string
  marketId: string
  sellerLegalEntityId: string
  currency: string
  resourceVersion: number
  /** Exact UTC source timestamp: milliseconds alone could hide an edit. */
  cartUpdatedAtExact: string
  evaluatedAt: string
  expiresAt: string
  policyReference: string
  charges: Item[]
}
export type SignedChargeEvidence = {
  evidence: ChargeEvidence
  /** Detached signature over canonical UTF-8 JSON; Ed25519 only. */
  signature: string
}
export type ChargeIssuerMandate = {
  outcome: "AUTHORIZED" | "DENIED" | "UNAVAILABLE"
  cpDecisionId: string
  issuerId: string
  tenantId: string
  marketId: string
  sellerLegalEntityId: string
  policyReference: string
  expiresAt: string
}
export type GovernedChargeIssuer = {
  /** A real issuer API or an independently approved operator command.
   * NEVER accept this value from an estate/browser request body.
   */
  obtainFromIssuer(cartId: string): Promise<SignedChargeEvidence>
  /** Live CP verification of the authorised issuer and current seller/Market
   * mandate. Trade cannot manufacture the decision from the evidence JWS.
   */
  verifyCpIssuer(evidence: ChargeEvidence): Promise<ChargeIssuerMandate>
  publicKey: KeyObject
  db: PgPool
}
const ID = /^[A-Za-z0-9._:-]{3,200}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MONEY = /^(0|[1-9][0-9]{0,15})$/
const PRINTABLE = /^[\x21-\x7e]{8,200}$/
const REQUIRED = new Set<string>(REQUIRED_CHARGES)
const ZERO = new Set<string>([
  "ZERO_RATE_AUTHORISED",
  "EXEMPTION_DOCUMENTED",
  "NOT_APPLICABLE_PER_INCOTERM",
])
const ENC = /^[A-Za-z0-9_-]{64,256}$/

function refuse(): never {
  throw new Error("GOVERNED_FINAL_CHARGE_ISSUER_NOT_PROVEN")
}
function assert(condition: unknown): asserts condition {
  if (!condition) refuse()
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]"
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    return (
      "{" +
      Object.keys(record)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(record[key]))
        .join(",") +
      "}"
    )
  }
  return JSON.stringify(value)
}
/** Canonical bytes signed by the external Ed25519 provider, independent of
 * JSON object insertion order. No browser may supply this trusted value.
 */
export function signedChargeBytes(evidence: ChargeEvidence): Buffer {
  return Buffer.from(canonical(evidence), "utf8")
}
function date(raw: string): number {
  const parsed = Date.parse(raw)
  assert(Number.isFinite(parsed) && parsed > 0)
  return parsed
}

/** Verify actual third-party signature AND a fresh independently queried
 * Control Plane mandate; a signed price is never itself buying permission.
 * Completeness is closed: all 7 kinds, explicit zero rationale, no extras.
 */
export async function verifyGovernedChargeEvidence(
  signed: SignedChargeEvidence,
  mandate: (value: ChargeEvidence) => Promise<ChargeIssuerMandate>,
  key: KeyObject,
  now = Date.now(),
): Promise<{ evidence: ChargeEvidence; decisionId: string; digest: string }> {
  try {
    assert(key.asymmetricKeyType === "ed25519")
    assert(
      signed !== null &&
        typeof signed === "object" &&
        Object.keys(signed).sort().join() === "evidence,signature" &&
        typeof signed.signature === "string" &&
        ENC.test(signed.signature),
    )
    const e = signed.evidence
    assert(
      e !== null &&
        typeof e === "object" &&
        Object.keys(e).sort().join() ===
          [
            "attestationId",
            "cartId",
            "cartUpdatedAtExact",
            "charges",
            "currency",
            "evaluatedAt",
            "expiresAt",
            "issuerId",
            "marketId",
            "policyReference",
            "resourceVersion",
            "sellerLegalEntityId",
            "tenantId",
          ]
            .sort()
            .join(),
    )
    assert(
      ID.test(e.issuerId) &&
        UUID.test(e.attestationId) &&
        /^cart_[A-Za-z0-9_-]{6,128}$/.test(e.cartId) &&
        ID.test(e.tenantId) &&
        ID.test(e.marketId) &&
        ID.test(e.sellerLegalEntityId) &&
        /^[A-Z]{3}$/.test(e.currency) &&
        Number.isSafeInteger(e.resourceVersion) &&
        e.resourceVersion > 0 &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(e.cartUpdatedAtExact) &&
        PRINTABLE.test(e.policyReference) &&
        Array.isArray(e.charges) &&
        e.charges.length === REQUIRED_CHARGES.length &&
        Number.isFinite(now),
    )
    const evaluated = date(e.evaluatedAt),
      expires = date(e.expiresAt)
    assert(
      evaluated <= now && expires > now && expires > evaluated && expires <= evaluated + 300000,
    )
    const kinds = new Set<string>()
    for (const line of e.charges) {
      assert(
        line &&
          typeof line === "object" &&
          Object.keys(line).sort().join() ===
            ["kind", "resolution", "amountMinor", "sourceReference", "zeroReason"].sort().join() &&
          REQUIRED.has(line.kind) &&
          !kinds.has(line.kind) &&
          ["CHARGED", "ZERO_RATED", "EXEMPT", "NOT_APPLICABLE"].includes(line.resolution) &&
          MONEY.test(line.amountMinor) &&
          BigInt(line.amountMinor) <= BigInt(Number.MAX_SAFE_INTEGER) &&
          PRINTABLE.test(line.sourceReference),
      )
      const charge = BigInt(line.amountMinor)
      assert(
        line.resolution === "CHARGED"
          ? charge > 0n && line.zeroReason === null
          : charge === 0n && typeof line.zeroReason === "string" && ZERO.has(line.zeroReason),
      )
      kinds.add(line.kind)
    }
    assert(kinds.size === REQUIRED_CHARGES.length)
    const payload = signedChargeBytes(e)
    const signature = Buffer.from(signed.signature, "base64url")
    assert(signature.length === 64 && verify(null, payload, key, signature))
    // Only after the signature passes may an issuer trigger a CP authority call.
    const cp = await mandate(e)
    assert(
      cp.outcome === "AUTHORIZED" &&
        UUID.test(cp.cpDecisionId) &&
        cp.issuerId === e.issuerId &&
        cp.tenantId === e.tenantId &&
        cp.marketId === e.marketId &&
        cp.sellerLegalEntityId === e.sellerLegalEntityId &&
        cp.policyReference === e.policyReference &&
        date(cp.expiresAt) > now,
    )
    return {
      evidence: e,
      decisionId: cp.cpDecisionId,
      digest: createHash("sha256").update(payload).digest("hex"),
    }
  } catch {
    return refuse()
  }
}

/** Issued immutable seven-charge evidence in one existing Trade PostgreSQL
 * database transaction. Source cart version is locked and checked at insert;
 * neither a missing tax/freight/duty nor a changed cart can be interpreted as
 * an authorised zero. A second issuer can't overwrite already-issued facts.
 */
export async function issueGovernedCartCharges(
  issuer: GovernedChargeIssuer,
  cartId: string,
): Promise<void> {
  if (!/^cart_[A-Za-z0-9_-]{6,128}$/.test(cartId)) refuse()
  const signed = await issuer.obtainFromIssuer(cartId)
  const validated = await verifyGovernedChargeEvidence(
    signed,
    (evidence) => issuer.verifyCpIssuer(evidence),
    issuer.publicKey,
  )
  const e = validated.evidence
  if (e.cartId !== cartId) refuse()
  const db = await issuer.db.connect()
  try {
    await db.query("BEGIN ISOLATION LEVEL SERIALIZABLE")
    const cart = await db.query(
      "SELECT currency_code,completed_at,updated_at," +
        "to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS exact_updated_at " +
        "FROM cart " +
        "WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [cartId],
    )
    if (
      cart.rows.length !== 1 ||
      cart.rows[0].completed_at !== null ||
      String(cart.rows[0].currency_code).toUpperCase() !== e.currency ||
      Date.parse(String(cart.rows[0].updated_at)) !== e.resourceVersion ||
      cart.rows[0].exact_updated_at !== e.cartUpdatedAtExact ||
      Date.parse(e.expiresAt) <= Date.now()
    )
      refuse()
    for (const charge of e.charges) {
      await db.query(
        "INSERT INTO trade_native_cart_charge_determination " +
          "(tenant_id,cart_id,market_id,seller_legal_entity_id,resource_version," +
          "charge_kind,resolution,amount_minor,currency,source_reference,evaluated_at,expires_at) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz)",
        [
          e.tenantId,
          e.cartId,
          e.marketId,
          e.sellerLegalEntityId,
          e.resourceVersion,
          charge.kind,
          charge.resolution,
          charge.amountMinor,
          e.currency,
          charge.sourceReference,
          e.evaluatedAt,
          e.expiresAt,
        ],
      )
      await db.query(
        "INSERT INTO trade_native_cart_charge_authority " +
          "(tenant_id,cart_id,market_id,seller_legal_entity_id,resource_version," +
          "charge_kind,issuer_id,attestation_id,cp_decision_id,source_digest,policy_reference,cart_updated_at_exact," +
          "zero_reason,canonical_evidence,issuer_signature,signer_key_fingerprint) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9::uuid,$10,$11,$12,$13,$14::jsonb,$15,$16)",
        [
          e.tenantId,
          e.cartId,
          e.marketId,
          e.sellerLegalEntityId,
          e.resourceVersion,
          charge.kind,
          e.issuerId,
          e.attestationId,
          validated.decisionId,
          validated.digest,
          e.policyReference,
          e.cartUpdatedAtExact,
          charge.zeroReason,
          JSON.stringify(e),
          signed.signature,
          createHash("sha256")
            .update(
              issuer.publicKey.export({
                type: "spki",
                format: "der",
              }),
            )
            .digest("hex"),
        ],
      )
    }
    await db.query("COMMIT")
  } catch {
    await db.query("ROLLBACK").catch(() => undefined)
    refuse()
  } finally {
    db.release()
  }
}
