import { bindingCommandDigest, assertBindingAdmission } from "./binding-authority-client"
import type { BindingActivation } from "./authenticated-binding-intake"
import { assertBindingActivation } from "./binding-activation-policy"
import {
  assertBindingApproval,
  parseBindingTimestamp,
  assertBindingProposal,
  assertBindingRevocation,
  type BindingApproval,
  type BindingProposal,
  type GovernedBindingScope,
} from "./governed-binding-command-policy"
import type {
  BindingAuthorityPorts,
  VerifiedActor,
  VerifiedEvidence,
} from "./governed-binding-service"
import type {
  NativeCheckoutAuthorization,
  NativeCheckoutAuthorizationStore,
} from "./native-cart-legal-seller"

/** Trusted runtime pool only; a Store request must never supply database access. */
export interface PgClient {
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    rows: Array<Record<string, unknown>>
    rowCount: number | null
  }>
  release(): void
}
export interface PgPool {
  connect(): Promise<PgClient>
}
type Persistence = BindingAuthorityPorts["persistence"]
const deny = (): never => {
  throw new Error("LA-05C5 denied: binding state transition rejected")
}
async function transaction(
  pool: PgPool,
  cartId: string,
  execute: (db: PgClient) => Promise<void>,
): Promise<void> {
  const db = await pool.connect()
  try {
    await db.query("BEGIN")
    await db.query("SET LOCAL lock_timeout = '3s'")
    await db.query("SET LOCAL statement_timeout = '5s'")
    // A row lock alone cannot serialize two proposals when no row exists yet.
    // All mutation paths take this cart fence first, then the stored row lock.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `seller-binding/${cartId}`,
    ])
    await execute(db)
    await db.query("COMMIT")
  } catch (error) {
    try {
      await db.query("ROLLBACK")
    } catch {
      /* Preserve the original denial. */
    }
    throw error
  } finally {
    db.release()
  }
}
const scopeValues = (s: GovernedBindingScope) => [
  s.cartId,
  s.tenantId,
  s.organisationId,
  s.responsibleLegalEntityId,
  s.marketCode,
  s.currencyCode,
  s.salesChannelId,
  s.regionId,
]
function exact(row: Record<string, unknown>, scope: GovernedBindingScope): boolean {
  return (
    row.cart_id === scope.cartId &&
    row.tenant_id === scope.tenantId &&
    row.organisation_id === scope.organisationId &&
    row.responsible_legal_entity_id === scope.responsibleLegalEntityId &&
    row.market_code === scope.marketCode &&
    row.currency_code === scope.currencyCode &&
    row.sales_channel_id === scope.salesChannelId &&
    row.region_id === scope.regionId
  )
}
function verified(actor: Partial<VerifiedActor>, evidence: VerifiedEvidence): void {
  if (
    !actor.issuer?.trim() ||
    !actor.tokenId?.trim() ||
    !evidence?.reference?.trim() ||
    !evidence.decisionId?.trim() ||
    !Number.isFinite(parseBindingTimestamp(evidence.verifiedAt))
  )
    deny()
}
async function record(
  db: PgClient,
  binding: Record<string, unknown>,
  scope: GovernedBindingScope,
  kind: "PROPOSED" | "APPROVED" | "REVOKED" | "ACTIVATED",
  actor: Partial<VerifiedActor>,
  evidence: VerifiedEvidence,
  reason: string | null = null,
): Promise<void> {
  const result = await db.query(
    `INSERT INTO la05_binding_decision
    (id,binding_id,binding_revision,cart_id,tenant_id,organisation_id,market_code,currency_code,
     decision,actor_subject,actor_issuer,actor_token_id,evidence_reference,evidence_decision_id,scope_snapshot,reason,authorization_snapshot)
    VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16::jsonb) RETURNING id`,
    [
      binding.id,
      binding.revision,
      scope.cartId,
      scope.tenantId,
      scope.organisationId,
      scope.marketCode,
      scope.currencyCode,
      kind,
      actor.subject,
      actor.issuer,
      actor.tokenId,
      evidence.reference,
      evidence.decisionId,
      JSON.stringify(scope),
      reason,
      evidence.admission ? JSON.stringify(evidence.admission) : null,
    ],
  )
  if (result.rows.length !== 1 || typeof result.rows[0].id !== "string") deny()
  // Local, unpublished audit records only. These candidate identifiers confer
  // no Shared producer rights and are never sent through the platform event relay.
  await db.query(
    `INSERT INTO la05_binding_outbox (id,decision_id,event_type,payload)
    VALUES (gen_random_uuid(),$1::uuid,$2,$3::jsonb)`,
    [
      result.rows[0].id,
      `trade.binding.${kind.toLowerCase()}.candidate`,
      JSON.stringify({
        decision_id: result.rows[0].id,
        binding_id: binding.id,
        binding_revision: binding.revision,
        actor_subject: actor.subject,
        evidence_decision_id: evidence.decisionId,
      }),
    ],
  )
}
async function requireUnexpired(db: PgClient, cartId: string): Promise<void> {
  const current = await db.query(
    `SELECT expires_at > clock_timestamp() AS valid
    FROM native_seller_cart_binding WHERE cart_id = $1 AND deleted_at IS NULL`,
    [cartId],
  )
  if (current.rows.length !== 1 || current.rows[0].valid !== true) deny()
}
/** Native cart row stays locked until COMMIT. The HTTP graph read alone is
 * insufficient: cart region/channel/currency/completion may change during I/O. */
async function lockNativeCoordinates(db: PgClient, scope: GovernedBindingScope): Promise<void> {
  const result = await db.query(
    "SELECT sales_channel_id,region_id,currency_code,completed_at FROM cart WHERE id=$1 AND deleted_at IS NULL FOR SHARE",
    [scope.cartId],
  )
  const c = result.rows[0]
  if (
    !c ||
    c.sales_channel_id !== scope.salesChannelId ||
    c.region_id !== scope.regionId ||
    String(c.currency_code).toUpperCase() !== scope.currencyCode ||
    c.completed_at
  )
    deny()
}
/**
 * P0-04B-01: applied Medusa lifecycle, immutable proposal comparison and atomic
 * revision/decision/audit receipts. Approval deliberately does NOT activate:
 * authenticated intake and CP-owned RUNTIME issuance are separate gates.
 */
export class PostgresGovernedBindingPersistence
  implements Persistence, NativeCheckoutAuthorizationStore
{
  constructor(
    private readonly pool: PgPool,
    private readonly now: () => number = Date.now,
  ) {}
  async load(cartId: string): Promise<
    | {
        scope: GovernedBindingScope
        proposal?: BindingProposal
        revision: number
        status: string
        approvedBy?: string
      }
    | undefined
  > {
    const db = await this.pool.connect()
    try {
      const result = await db.query(
        "SELECT * FROM native_seller_cart_binding WHERE cart_id=$1 AND deleted_at IS NULL",
        [cartId],
      )
      const row = result.rows[0]
      if (!row) return undefined
      return {
        scope: {
          cartId: row.cart_id as string,
          tenantId: row.tenant_id as string,
          organisationId: row.organisation_id as string,
          responsibleLegalEntityId: row.responsible_legal_entity_id as string,
          marketCode: row.market_code as string,
          currencyCode: row.currency_code as string,
          salesChannelId: row.sales_channel_id as string,
          regionId: row.region_id as string,
        },
        proposal: row.proposal_snapshot ? (row.proposal_snapshot as BindingProposal) : undefined,
        revision: Number(row.revision),
        status: String(row.status),
        approvedBy: typeof row.approved_by === "string" ? row.approved_by : undefined,
      }
    } finally {
      db.release()
    }
  }
  async activate(proof: BindingActivation): Promise<void> {
    assertBindingActivation(proof, this.now())
    await transaction(this.pool, proof.scope.cartId, async (db) => {
      await lockNativeCoordinates(db, proof.scope)
      const result = await db.query(
        "SELECT * FROM native_seller_cart_binding WHERE cart_id=$1 FOR UPDATE",
        [proof.scope.cartId],
      )
      const row = result.rows[0]
      if (
        !row ||
        !exact(row, proof.scope) ||
        row.status !== "PROPOSED" ||
        !row.approved_by ||
        row.revision !== proof.revision ||
        [row.proposed_by, row.approved_by].includes(proof.actor.subject)
      )
        deny()
      const previous = await db.query(
        `SELECT decision,actor_subject,authorization_snapshot FROM la05_binding_decision
        WHERE binding_id=$1 AND decision IN ('PROPOSED','APPROVED') ORDER BY binding_revision`,
        [row.id],
      )
      if (
        previous.rows.length !== 2 ||
        previous.rows[0].decision !== "PROPOSED" ||
        previous.rows[1].decision !== "APPROVED" ||
        previous.rows[0].actor_subject !== row.proposed_by ||
        previous.rows[1].actor_subject !== row.approved_by ||
        !previous.rows.every((receipt) => receipt.authorization_snapshot)
      )
        deny()
      assertBindingAdmission(
        proof.admission,
        "activate",
        proof.scope,
        bindingCommandDigest({
          operation: "activate",
          scope: proof.scope,
          input: { revision: proof.revision },
          revision: proof.revision,
          proposal: row.proposal_snapshot,
        }),
        this.now(),
      )
      assertBindingActivation(proof, this.now())
      const changed = await db.query(
        `UPDATE native_seller_cart_binding SET status='ACTIVE',context_id=$2,market_key=$3,legal_activity=$4,legal_capability=$5,activation_snapshot=$6::jsonb,updated_at=clock_timestamp()
        WHERE cart_id=$1 AND status='PROPOSED' AND approved_by IS NOT NULL AND revision=$7 AND expires_at>clock_timestamp() AND deleted_at IS NULL RETURNING id,revision`,
        [
          proof.scope.cartId,
          proof.context.context_id,
          proof.context.market_id,
          "B2B_COFFEE_SALE",
          "commerce.order.create",
          JSON.stringify(proof),
          proof.revision,
        ],
      )
      if (changed.rowCount !== 1) deny()
      const binding = changed.rows[0]
      await db.query(
        `INSERT INTO la05_binding_activation (binding_id,binding_revision,proof) VALUES ($1,$2,$3::jsonb)`,
        [binding.id, binding.revision, JSON.stringify(proof)],
      )
      await record(db, binding, proof.scope, "ACTIVATED", proof.actor, {
        reference: `cp/trade-binding/${proof.admission.decision_id}`,
        decisionId: proof.admission.decision_id,
        verifiedAt: proof.admission.evaluated_at,
        admission: proof.admission,
      })
      await requireUnexpired(db, proof.scope.cartId)
      assertBindingActivation(proof, this.now())
    })
  }
  async propose(command: BindingProposal, evidence: VerifiedEvidence): Promise<void> {
    assertBindingProposal(command, this.now())
    verified(command.maker, evidence)
    if (evidence.reference !== command.evidenceReference) deny()
    await transaction(this.pool, command.scope.cartId, async (db) => {
      const s = command.scope
      if (evidence.admission) await lockNativeCoordinates(db, s)
      const existing = await db.query(
        "SELECT * FROM native_seller_cart_binding WHERE cart_id = $1 FOR UPDATE",
        [s.cartId],
      )
      if (existing.rows.length) deny() // No reissue, including soft-deleted or revoked records.
      const inserted = await db.query(
        `INSERT INTO native_seller_cart_binding
        (id,cart_id,tenant_id,organisation_id,context_id,responsible_legal_entity_id,
         sales_channel_id,region_id,market_code,market_key,legal_activity,legal_capability,
         currency_code,approval_scope,proposed_by,proposed_at,expires_at,status,correlation_id,proposal_snapshot)
        SELECT 'lsbind_' || replace(gen_random_uuid()::text,'-',''),$1,$2,$3,'PENDING',$4,$7,$8,$5,
          'PENDING','PENDING','PENDING',$6,'SELLER_OF_RECORD_CART_BINDING',$9,$10::timestamptz,$11::timestamptz,
          'PROPOSED',$12,$13::jsonb
        WHERE $10::timestamptz <= clock_timestamp() AND $11::timestamptz > clock_timestamp()
        RETURNING id,revision`,
        [
          ...scopeValues(s),
          command.maker.subject,
          command.proposedAt,
          command.expiresAt,
          evidence.decisionId,
          JSON.stringify(command),
        ],
      )
      if (inserted.rowCount !== 1) deny()
      await record(db, inserted.rows[0], s, "PROPOSED", command.maker, evidence)
      await requireUnexpired(db, s.cartId)
    })
  }
  async approve(command: BindingApproval, evidence: VerifiedEvidence): Promise<void> {
    assertBindingApproval(command, this.now())
    verified(command.checker, evidence)
    if (evidence.reference !== command.approvalReference) deny()
    await transaction(this.pool, command.proposal.scope.cartId, async (db) => {
      const s = command.proposal.scope
      if (evidence.admission) await lockNativeCoordinates(db, s)
      const locked = await db.query(
        "SELECT * FROM native_seller_cart_binding WHERE cart_id = $1 FOR UPDATE",
        [s.cartId],
      )
      if (
        locked.rows.length !== 1 ||
        !exact(locked.rows[0], s) ||
        (evidence.expectedRevision !== undefined &&
          locked.rows[0].revision !== evidence.expectedRevision) ||
        locked.rows[0].status !== "PROPOSED" ||
        locked.rows[0].proposed_by !== command.proposal.maker.subject
      )
        deny()
      // JSONB equality binds every original proposal field, maker identity,
      // expiry and evidence reference; the request cannot replace stored facts.
      // clock_timestamp is real time AFTER a lock wait, unlike transaction time.
      const changed = await db.query(
        `UPDATE native_seller_cart_binding
        SET approved_by=$2,approved_at=clock_timestamp(),approval_reference=$3,updated_at=clock_timestamp()
        WHERE cart_id=$1 AND status='PROPOSED' AND approved_by IS NULL AND proposed_by<>$2
          AND expires_at>clock_timestamp() AND deleted_at IS NULL AND proposal_snapshot=$4::jsonb
        RETURNING id,revision`,
        [
          s.cartId,
          command.checker.subject,
          command.approvalReference,
          JSON.stringify(command.proposal),
        ],
      )
      if (changed.rowCount !== 1) deny()
      await record(db, changed.rows[0], s, "APPROVED", command.checker, evidence)
      await requireUnexpired(db, s.cartId)
    })
  }
  /**
   * P0-04B-03: durable receipt of the validate hook's CP/Payments assessment.
   * The database re-verifies the ACTIVE binding revision and open cart under
   * the seller-binding fence; the cart commit-point trigger consumes it once.
   */
  async record(authorization: NativeCheckoutAuthorization): Promise<void> {
    const a = authorization
    const legal = parseBindingTimestamp(a?.legalValidUntil)
    const ready = parseBindingTimestamp(a?.readinessValidUntil)
    if (
      !a?.cartId?.trim() ||
      a.idempotencyKey !== `native-checkout/${a.cartId}` ||
      ![
        a.contextId,
        a.responsibleLegalEntityId,
        a.mandateId,
        a.providerCertificationReference,
        a.merchantActivationReference,
        a.policyReference,
      ].every((value) => typeof value === "string" && value.trim().length > 0) ||
      !Number.isFinite(legal) ||
      !Number.isFinite(ready) ||
      Math.min(legal, ready) <= this.now()
    )
      throw new Error("P0-04B-03 denied: checkout authorization incomplete or expired")
    await transaction(this.pool, a.cartId, async (db) => {
      // Medusa runs the validate hook on a completeCart replay too. A checkout
      // already committed under a live consumption resolves to the original
      // order (ADR-0014 §26–30); it needs, and may record, nothing new.
      const committed = await db.query(
        `SELECT 1 FROM la05_checkout_authorization receipt
        JOIN cart ON cart.id = receipt.cart_id AND cart.completed_at IS NOT NULL
        WHERE receipt.idempotency_key=$1 AND receipt.consumed_at IS NOT NULL
          AND receipt.released_at IS NULL`,
        [a.idempotencyKey],
      )
      if (committed.rows.length) return
      const binding = await db.query(
        `SELECT id,revision FROM native_seller_cart_binding
        WHERE cart_id=$1 AND status='ACTIVE' AND deleted_at IS NULL`,
        [a.cartId],
      )
      if (binding.rows.length !== 1)
        throw new Error("P0-04B-03 denied: no ACTIVE seller binding for checkout")
      const inserted = await db.query(
        `INSERT INTO la05_checkout_authorization
        (cart_id,binding_id,binding_revision,context_id,responsible_legal_entity_id,mandate_id,
         legal_valid_until,provider_certification_reference,merchant_activation_reference,policy_reference,
         readiness_valid_until,lease_expires_at,idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11::timestamptz,
          LEAST($7::timestamptz,$11::timestamptz),$12) RETURNING id`,
        [
          a.cartId,
          binding.rows[0].id,
          binding.rows[0].revision,
          a.contextId,
          a.responsibleLegalEntityId,
          a.mandateId,
          a.legalValidUntil,
          a.providerCertificationReference,
          a.merchantActivationReference,
          a.policyReference,
          a.readinessValidUntil,
          a.idempotencyKey,
        ],
      )
      if (inserted.rowCount !== 1) throw new Error("P0-04B-03 denied: authorization not recorded")
    })
  }
  async revoke(
    scope: GovernedBindingScope,
    actor: VerifiedActor,
    reason: string,
    evidence: VerifiedEvidence,
  ): Promise<void> {
    assertBindingRevocation(scope, actor, reason, evidence.reference)
    verified(actor, evidence)
    await transaction(this.pool, scope.cartId, async (db) => {
      const locked = await db.query(
        "SELECT * FROM native_seller_cart_binding WHERE cart_id = $1 FOR UPDATE",
        [scope.cartId],
      )
      if (
        locked.rows.length !== 1 ||
        !exact(locked.rows[0], scope) ||
        (evidence.expectedRevision !== undefined &&
          locked.rows[0].revision !== evidence.expectedRevision) ||
        !["PROPOSED", "ACTIVE"].includes(String(locked.rows[0].status))
      )
        deny()
      const changed = await db.query(
        `UPDATE native_seller_cart_binding
        SET status='REVOKED',updated_at=clock_timestamp()
        WHERE cart_id=$1 AND status IN ('PROPOSED','ACTIVE') AND deleted_at IS NULL RETURNING id,revision`,
        [scope.cartId],
      )
      if (changed.rowCount !== 1) deny()
      await record(db, changed.rows[0], scope, "REVOKED", actor, evidence, reason)
    })
  }
}
