import type {
  BindingApproval,
  BindingProposal,
  GovernedBindingScope,
} from "./governed-binding-command-policy"
import type {
  BindingAuthorityPorts,
  VerifiedActor,
  VerifiedEvidence,
} from "./governed-binding-service"

/** pg.Pool-compatible interface; injected by the Medusa runtime, never created from Store API input. */
export interface PgClient {
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>
  release(): void
}
export interface PgPool {
  connect(): Promise<PgClient>
}
type Persistence = BindingAuthorityPorts["persistence"]
const deny = (): never => {
  throw new Error("LA-05C5 denied: binding state transition rejected")
}
async function transaction(pool: PgPool, execute: (db: PgClient) => Promise<void>): Promise<void> {
  const db = await pool.connect()
  try {
    await db.query("BEGIN")
    await execute(db)
    await db.query("COMMIT")
  } catch (error) {
    try {
      await db.query("ROLLBACK")
    } catch {
      /* retain original error */
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
async function event(
  db: PgClient,
  id: string,
  kind: string,
  actor: string,
  evidence: VerifiedEvidence,
): Promise<void> {
  await db.query(
    "INSERT INTO la05_binding_outbox (id, decision_id, event_type, payload) VALUES (gen_random_uuid(), $1::uuid, $2, $3::jsonb)",
    [
      id,
      kind,
      JSON.stringify({
        decision_id: id,
        actor_subject: actor,
        evidence_decision_id: evidence.decisionId,
      }),
    ],
  )
}
/**
 * Transactional PostgreSQL 17 adapter. Requires the reviewed LA-05C5 migration.
 * Event identifiers are LOCAL CANDIDATES until Shared approves canonical names.
 */
export class PostgresGovernedBindingPersistence implements Persistence {
  constructor(private readonly pool: PgPool) {}
  async propose(command: BindingProposal, evidence: VerifiedEvidence): Promise<void> {
    await transaction(this.pool, async (db) => {
      const s = command.scope
      const existing = await db.query(
        "SELECT * FROM native_seller_cart_binding WHERE cart_id = $1 FOR UPDATE",
        [s.cartId],
      )
      if (existing.rows.length) deny() // never silently replace a binding or reissue revoked authority
      const inserted = await db.query(
        `INSERT INTO native_seller_cart_binding
        (id, cart_id, tenant_id, organisation_id, context_id, responsible_legal_entity_id,
        sales_channel_id, region_id, market_code, market_key, legal_activity, legal_capability,
        currency_code, approval_scope, proposed_by, proposed_at, expires_at, status, correlation_id)
        VALUES ('lsbind_' || replace(gen_random_uuid()::text, '-', ''), $1,$2,$3,'PENDING',$4,$7,$8,$5,'PENDING','PENDING','PENDING',$6,
        'SELLER_OF_RECORD_CART_BINDING',$9,$10,$11,'PROPOSED',$12)`,
        [
          ...scopeValues(s),
          command.maker.subject,
          command.proposedAt,
          command.expiresAt,
          evidence.decisionId,
        ],
      )
      if (inserted.rowCount !== 1) deny()
      const decision = await db.query(
        `INSERT INTO la05_binding_decision
        (id,cart_id,tenant_id,organisation_id,market_code,currency_code,decision,actor_subject,evidence_reference,evidence_decision_id)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'PROPOSED',$6,$7,$8) RETURNING id`,
        [
          s.cartId,
          s.tenantId,
          s.organisationId,
          s.marketCode,
          s.currencyCode,
          command.maker.subject,
          command.evidenceReference,
          evidence.decisionId,
        ],
      )
      await event(
        db,
        String(decision.rows[0]?.id),
        "trade.binding.proposed.candidate",
        command.maker.subject,
        evidence,
      )
    })
  }
  async approve(command: BindingApproval, evidence: VerifiedEvidence): Promise<void> {
    await transaction(this.pool, async (db) => {
      const s = command.proposal.scope
      const locked = await db.query(
        "SELECT * FROM native_seller_cart_binding WHERE cart_id = $1 FOR UPDATE",
        [s.cartId],
      )
      if (
        locked.rows.length !== 1 ||
        !exact(locked.rows[0], s) ||
        locked.rows[0].status !== "PROPOSED" ||
        locked.rows[0].proposed_by !== command.proposal.maker.subject
      )
        deny()
      // Do not activate placeholder context/legal activity. CP-issued mandate binding
      // requires an additional approved authoritative activation adapter.
      const decision = await db.query(
        `INSERT INTO la05_binding_decision
        (id,cart_id,tenant_id,organisation_id,market_code,currency_code,decision,actor_subject,evidence_reference,evidence_decision_id)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'APPROVED',$6,$7,$8) RETURNING id`,
        [
          s.cartId,
          s.tenantId,
          s.organisationId,
          s.marketCode,
          s.currencyCode,
          command.checker.subject,
          command.approvalReference,
          evidence.decisionId,
        ],
      )
      await event(
        db,
        String(decision.rows[0]?.id),
        "trade.binding.approved.candidate",
        command.checker.subject,
        evidence,
      )
    })
  }
  async revoke(
    scope: GovernedBindingScope,
    actor: VerifiedActor,
    reason: string,
    evidence: VerifiedEvidence,
  ): Promise<void> {
    await transaction(this.pool, async (db) => {
      const locked = await db.query(
        "SELECT * FROM native_seller_cart_binding WHERE cart_id = $1 FOR UPDATE",
        [scope.cartId],
      )
      if (
        locked.rows.length !== 1 ||
        !exact(locked.rows[0], scope) ||
        !["PROPOSED", "ACTIVE"].includes(String(locked.rows[0].status))
      )
        deny()
      const changed = await db.query(
        "UPDATE native_seller_cart_binding SET status = 'REVOKED' WHERE cart_id = $1 AND status IN ('PROPOSED','ACTIVE')",
        [scope.cartId],
      )
      if (changed.rowCount !== 1) deny()
      const decision = await db.query(
        `INSERT INTO la05_binding_decision
        (id,cart_id,tenant_id,organisation_id,market_code,currency_code,decision,actor_subject,evidence_reference,evidence_decision_id)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'REVOKED',$6,$7,$8) RETURNING id`,
        [
          scope.cartId,
          scope.tenantId,
          scope.organisationId,
          scope.marketCode,
          scope.currencyCode,
          actor.subject,
          evidence.reference,
          evidence.decisionId,
        ],
      )
      await event(
        db,
        String(decision.rows[0]?.id),
        "trade.binding.revoked.candidate",
        actor.subject,
        evidence,
      )
      void reason // canonical event reason field awaits Shared schema agreement
    })
  }
}
