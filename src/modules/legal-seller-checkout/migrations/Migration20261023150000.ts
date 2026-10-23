import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-042 sections 9, 12 and 14, Decisions 5, 6 and 9 (Shared trade/v2
 * buyer-authority-receipt; ADR-0037): the B2B regime of the universal native
 * commit fence (Migration20261023120000).
 *
 * 1. trade_buyer_authority_receipt is the server-built BuyerAuthorityReceipt
 *    Trade records when the buyer operation decision is ALLOW. It is
 *    immutable, lives at most 60 seconds, and is bound to the reservation it
 *    names, at that reservation's exact purchase, amount and hold revision.
 * 2. trade_buyer_authority_consumption is its one consumption. Only the fence
 *    writes it, in the order's own transaction, together with the seller
 *    receipt consumption and the spend reservation's conversion to committed
 *    consumption. An order therefore commits only when one current buyer
 *    receipt and one current seller receipt name the same operation reference,
 *    and the buyer's reservation converts in the same native transaction.
 * 3. The fence's B2B branch, for a B2B classification, requires exactly one
 *    live buyer receipt for the seller receipt's operation and reference, and
 *    refuses with the contract's consumptionRefusal codes:
 *    - FOREIGN_RECEIPT: another resource, Tenant, buyer, membership, Market,
 *      currency or seller binding than the commitment;
 *    - RECEIPT_EXPIRED, RECEIPT_CONSUMED;
 *    - MEMBERSHIP_REVISED: the membership is no longer ACTIVE at that revision;
 *    - TRANSACTION_MISMATCH: the reservation no longer holds this purchase,
 *      amount or hold revision;
 *    - RESERVATION_NOT_CURRENT: the reservation is not ACTIVE and unexpired,
 *      or a currently applicable budget does not hold the full amount, or
 *      the ledger refuses the conversion.
 *    With no live buyer receipt at all, the verdict stays
 *    BUYER_AUTHORITY_ABSENT.
 *
 * The composition runs in a subtransaction. In SHADOW a refused composition
 * changes nothing and the order proceeds with the verdict recorded; in
 * ENFORCED it raises and everything rolls back together. A successful
 * composition is the real conversion in either mode. Nothing here writes a
 * buyer receipt or activates the gate.
 */
export class Migration20261023150000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`DO $$ BEGIN
      IF to_regclass('public.trade_commit_fence_enforcement') IS NULL THEN
        RAISE EXCEPTION 'the B2B regime requires the universal commit fence (Migration20261023120000)';
      END IF;
    END $$;`)

    this.addSql(`CREATE TABLE trade_buyer_authority_receipt (
      receipt_id uuid PRIMARY KEY,
      context_id uuid NOT NULL,
      decision_id uuid NOT NULL UNIQUE,
      correlation_id uuid NOT NULL,
      operation text NOT NULL CHECK (operation IN ('trade.order.commit', 'trade.order.create', 'trade.draft-order.finalize')),
      operation_reference text NOT NULL CHECK (length(operation_reference) BETWEEN 1 AND 256
        AND operation_reference ~ '^[\\x21-\\x7E]+$'),
      actor_principal_id text NOT NULL CHECK (length(btrim(actor_principal_id)) > 0),
      tenant_id text NOT NULL,
      canonical_organisation_id text NOT NULL,
      buyer_organisation_id text NOT NULL,
      buyer_membership_id text NOT NULL,
      membership_revision integer NOT NULL CHECK (membership_revision >= 1),
      market_id text NOT NULL,
      resource_id text NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 200),
      resource_version integer NOT NULL CHECK (resource_version >= 1),
      transaction_digest text NOT NULL CHECK (transaction_digest ~ '^sha256:[0-9a-f]{64}$'),
      amount_minor numeric NOT NULL CHECK (amount_minor > 0 AND amount_minor = trunc(amount_minor)),
      currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      valuation_digest text NOT NULL,
      policy_revision integer NOT NULL CHECK (policy_revision >= 1),
      approval_references text[] NOT NULL DEFAULT '{}',
      spend_reservation_id text NOT NULL,
      spend_hold_revision integer NOT NULL CHECK (spend_hold_revision >= 1),
      seller_legal_entity_id text NOT NULL,
      seller_binding_id uuid NOT NULL,
      seller_binding_version integer NOT NULL CHECK (seller_binding_version >= 1),
      evaluated_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      evidence_references text[] NOT NULL DEFAULT '{}',
      receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object' AND receipt->>'receipt_id' = receipt_id::text),
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (expires_at > evaluated_at AND expires_at <= evaluated_at + interval '60 seconds'));
    -- At most one live receipt per operation reference: never two buyer decisions for one seller decision.
    CREATE INDEX trade_buyer_authority_receipt_operation
      ON trade_buyer_authority_receipt (operation, operation_reference);

    CREATE FUNCTION trade_buyer_authority_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE reservation b2b_spend_reservation%ROWTYPE;
    BEGIN
      IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Decision 6: a buyer-authority receipt is immutable';
      END IF;
      IF NEW.expires_at <= clock_timestamp() OR NEW.evaluated_at > clock_timestamp() + interval '5 seconds' THEN
        RAISE EXCEPTION 'Decision 6: a buyer-authority receipt is recorded only while current';
      END IF;
      SELECT * INTO reservation FROM b2b_spend_reservation WHERE id = NEW.spend_reservation_id;
      IF reservation.id IS NULL OR reservation.status <> 'ACTIVE' OR reservation.expires_at <= clock_timestamp()
         OR reservation.tenant_id <> NEW.tenant_id OR reservation.organisation_id <> NEW.buyer_organisation_id
         OR reservation.membership_id <> NEW.buyer_membership_id OR reservation.currency_code <> NEW.currency
         OR reservation.transaction_digest <> NEW.transaction_digest
         OR reservation.resource_version <> NEW.resource_version
         OR reservation.amount_minor IS DISTINCT FROM NEW.amount_minor
         OR reservation.hold_revision IS DISTINCT FROM NEW.spend_hold_revision THEN
        RAISE EXCEPTION 'Decision 6: a buyer-authority receipt names an ACTIVE reservation for exactly its purchase';
      END IF;
      IF EXISTS (SELECT 1 FROM trade_buyer_authority_receipt r
           WHERE r.operation = NEW.operation AND r.operation_reference = NEW.operation_reference
             AND r.expires_at > clock_timestamp()
             AND NOT EXISTS (SELECT 1 FROM trade_buyer_authority_consumption c WHERE c.receipt_id = r.receipt_id)) THEN
        RAISE EXCEPTION 'Decision 6: one live buyer-authority receipt per operation reference';
      END IF;
      RETURN NEW;
    END $$;

    CREATE TABLE trade_buyer_authority_consumption (
      receipt_id uuid PRIMARY KEY REFERENCES trade_buyer_authority_receipt (receipt_id),
      operation_reference text NOT NULL,
      seller_receipt_id uuid NOT NULL UNIQUE REFERENCES trade_order_authority_receipt (receipt_id),
      spend_reservation_id text NOT NULL UNIQUE,
      commitment_reference text NOT NULL CHECK (length(btrim(commitment_reference)) > 0),
      consumed_at timestamptz NOT NULL DEFAULT clock_timestamp());

    CREATE TRIGGER trade_buyer_authority_receipt_guard
      BEFORE INSERT OR UPDATE OR DELETE ON trade_buyer_authority_receipt
      FOR EACH ROW EXECUTE FUNCTION trade_buyer_authority_receipt_guard();
    CREATE TRIGGER trade_buyer_authority_receipt_no_truncate
      BEFORE TRUNCATE ON trade_buyer_authority_receipt
      FOR EACH STATEMENT EXECUTE FUNCTION trade_commit_fence_decision_immutable();

    CREATE FUNCTION trade_buyer_authority_consumption_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Decision 6: a buyer-authority consumption is append-only';
      END IF;
      IF pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'Decision 6: a buyer-authority receipt is consumed only at the native commit fence';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trade_buyer_authority_consumption_guard
      BEFORE INSERT OR UPDATE OR DELETE ON trade_buyer_authority_consumption
      FOR EACH ROW EXECUTE FUNCTION trade_buyer_authority_consumption_guard();
    CREATE TRIGGER trade_buyer_authority_consumption_no_truncate
      BEFORE TRUNCATE ON trade_buyer_authority_consumption
      FOR EACH STATEMENT EXECUTE FUNCTION trade_commit_fence_decision_immutable();`)

    this
      .addSql(`ALTER TABLE trade_commit_fence_decision DROP CONSTRAINT trade_commit_fence_decision_outcome_check;
    ALTER TABLE trade_commit_fence_decision ADD CONSTRAINT trade_commit_fence_decision_outcome_check
      CHECK (outcome IN ('ALLOWED', 'CLASSIFICATION_ABSENT', 'CLASSIFICATION_CHANGED', 'CLASSIFICATION_CONFLICT',
        'PROFILE_NOT_ACTIVE', 'BUYER_AUTHORITY_ABSENT', 'FOREIGN_RECEIPT', 'RECEIPT_EXPIRED', 'RECEIPT_CONSUMED',
        'MEMBERSHIP_REVISED', 'TRANSACTION_MISMATCH', 'RESERVATION_NOT_CURRENT'));
    ALTER TABLE trade_commit_fence_decision ADD COLUMN buyer_receipt_id uuid;`)

    // The B2B composition. It returns NULL when the buyer receipt was
    // consumed and the reservation converted, or the refusal.
    this
      .addSql(`CREATE FUNCTION trade_commit_fence_b2b(commitment trade_order_commitment, c trade_native_commitment_classification,
        seller trade_order_authority_receipt, OUT reason text, OUT buyer_receipt uuid) LANGUAGE plpgsql AS $$
    DECLARE b trade_buyer_authority_receipt%ROWTYPE; reservation b2b_spend_reservation%ROWTYPE;
            membership b2b_buyer_membership%ROWTYPE; policy record; hold record; applicable integer := 0;
    BEGIN
      -- The receipt for exactly this seller decision: the unconsumed one, or
      -- else the last consumed one (a replay). A consumed receipt is history.
      SELECT ar.* INTO b FROM trade_buyer_authority_receipt ar
        WHERE ar.operation = seller.operation_class AND ar.operation_reference = seller.operation_reference
          AND NOT EXISTS (SELECT 1 FROM trade_buyer_authority_consumption x WHERE x.receipt_id = ar.receipt_id)
        ORDER BY ar.recorded_at DESC LIMIT 1;
      IF b.receipt_id IS NULL THEN
        SELECT ar.* INTO b FROM trade_buyer_authority_receipt ar
          WHERE ar.operation = seller.operation_class AND ar.operation_reference = seller.operation_reference
          ORDER BY ar.recorded_at DESC LIMIT 1;
        IF b.receipt_id IS NULL THEN
          reason := 'BUYER_AUTHORITY_ABSENT'; RETURN;
        END IF;
        buyer_receipt := b.receipt_id;
        reason := 'RECEIPT_CONSUMED'; RETURN;
      END IF;
      buyer_receipt := b.receipt_id;
      IF b.expires_at <= clock_timestamp() THEN
        reason := 'RECEIPT_EXPIRED'; RETURN;
      END IF;
      IF b.resource_id <> commitment.subject_id OR b.tenant_id <> c.tenant_id OR b.market_id <> c.market_id
         OR b.buyer_organisation_id IS DISTINCT FROM c.buyer_organisation_id
         OR b.buyer_membership_id IS DISTINCT FROM c.buyer_membership_id
         OR b.currency <> seller.currency OR b.tenant_id <> seller.tenant_id
         OR b.seller_binding_id <> seller.binding_id OR b.seller_binding_version <> seller.binding_version THEN
        reason := 'FOREIGN_RECEIPT'; RETURN;
      END IF;
      SELECT * INTO membership FROM b2b_buyer_membership WHERE id = b.buyer_membership_id;
      IF membership.id IS NULL OR membership.status <> 'ACTIVE' OR membership.revision <> b.membership_revision
         OR membership.organisation_id <> b.buyer_organisation_id THEN
        reason := 'MEMBERSHIP_REVISED'; RETURN;
      END IF;
      SELECT * INTO reservation FROM b2b_spend_reservation WHERE id = b.spend_reservation_id FOR UPDATE;
      IF reservation.id IS NULL OR reservation.status <> 'ACTIVE' OR reservation.expires_at <= clock_timestamp() THEN
        reason := 'RESERVATION_NOT_CURRENT'; RETURN;
      END IF;
      IF reservation.transaction_digest <> b.transaction_digest OR reservation.resource_version <> b.resource_version
         OR reservation.amount_minor IS DISTINCT FROM b.amount_minor
         OR reservation.hold_revision IS DISTINCT FROM b.spend_hold_revision
         OR reservation.organisation_id <> b.buyer_organisation_id OR reservation.membership_id <> b.buyer_membership_id THEN
        reason := 'TRANSACTION_MISMATCH'; RETURN;
      END IF;

      -- Every currently applicable budget (the same rule as the TypeScript
      -- commit command) must hold the full amount in its current period at
      -- its current revision, and no other hold may still reserve capacity.
      FOR policy IN SELECT p.id, p.revision,
            CASE WHEN p.period_kind = 'CALENDAR_MONTH'
                 THEN date_trunc('month', now() AT TIME ZONE p.timezone) AT TIME ZONE p.timezone
                 ELSE p.effective_from END AS period_starts_at
          FROM b2b_spend_budget_policy p
         WHERE p.tenant_id = reservation.tenant_id AND p.organisation_id = reservation.organisation_id
           AND p.market_key = reservation.market_key AND p.currency_code = reservation.currency_code
           AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
           AND p.effective_from <= now() AND (p.effective_until IS NULL OR now() < p.effective_until)
           AND ((p.scope = 'MEMBERSHIP' AND p.membership_id = reservation.membership_id) OR p.scope = 'ORGANISATION'
                OR (p.scope = 'AGREEMENT' AND p.agreement_reference = reservation.agreement_reference))
         ORDER BY p.id COLLATE "C" FOR SHARE OF p LOOP
        applicable := applicable + 1;
        IF NOT EXISTS (SELECT 1 FROM b2b_spend_reservation_hold h
             WHERE h.reservation_id = reservation.id AND h.budget_policy_id = policy.id
               AND h.policy_revision = policy.revision AND h.period_starts_at = policy.period_starts_at
               AND h.reserved_minor = reservation.amount_minor) THEN
          reason := 'RESERVATION_NOT_CURRENT'; RETURN;
        END IF;
      END LOOP;
      IF applicable = 0 OR EXISTS (SELECT 1 FROM b2b_spend_reservation_hold h
           WHERE h.reservation_id = reservation.id AND h.reserved_minor > 0
             AND NOT EXISTS (SELECT 1 FROM b2b_spend_budget_policy p WHERE p.id = h.budget_policy_id
                  AND p.status = 'ACTIVE' AND p.revision = h.policy_revision)) THEN
        reason := 'RESERVATION_NOT_CURRENT'; RETURN;
      END IF;

      -- Consume the receipt and convert the reservation together; the ledger
      -- trigger is the capacity authority and refuses anything stale.
      BEGIN
        INSERT INTO trade_buyer_authority_consumption (receipt_id, operation_reference, seller_receipt_id,
            spend_reservation_id, commitment_reference)
          VALUES (b.receipt_id, b.operation_reference, seller.receipt_id, reservation.id,
            commitment.subject_type || ':' || commitment.subject_id);
        FOR hold IN SELECT h.budget_policy_id, h.policy_revision, h.reserved_minor FROM b2b_spend_reservation_hold h
            WHERE h.reservation_id = reservation.id AND h.reserved_minor > 0
            ORDER BY h.budget_policy_id COLLATE "C" LOOP
          INSERT INTO b2b_spend_ledger_entry (id, entry_kind, reservation_id, budget_policy_id, policy_revision,
              amount_minor, raw_amount_minor, commitment_reference, idempotency_key, actor_principal_id)
            VALUES ('b2bled_' || replace(gen_random_uuid()::text, '-', ''), 'COMMIT', reservation.id,
              hold.budget_policy_id, hold.policy_revision, hold.reserved_minor, '{}',
              commitment.subject_type || ':' || commitment.subject_id,
              'fence.' || replace(b.receipt_id::text, '-', '') || '.' || md5(hold.budget_policy_id), b.actor_principal_id);
        END LOOP;
        UPDATE b2b_spend_reservation SET status = 'COMMITTED' WHERE id = reservation.id;
      EXCEPTION WHEN OTHERS THEN
        reason := 'RESERVATION_NOT_CURRENT';
      END;
    END $$;`)

    this
      .addSql(`CREATE OR REPLACE FUNCTION trade_order_commitment_classification() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE c trade_native_commitment_classification%ROWTYPE; r trade_order_authority_receipt%ROWTYPE;
            latest trade_commerce_profile_observation%ROWTYPE; gate trade_commit_fence_enforcement%ROWTYPE;
            reason text; buyer_receipt uuid;
    BEGIN
      -- FOR SHARE serializes the verdict with a gate change (Migration20261023120000).
      SELECT * INTO gate FROM trade_commit_fence_enforcement WHERE singleton FOR SHARE;
      IF gate.mode IS NULL THEN
        RAISE EXCEPTION 'Decision 9 denied: the commit fence enforcement gate is missing';
      END IF;

      SELECT * INTO c FROM trade_native_commitment_classification
        WHERE resource_type = NEW.subject_type AND resource_id = NEW.subject_id AND status = 'ACTIVE';
      IF c.classification_id IS NULL THEN
        reason := CASE WHEN EXISTS (SELECT 1 FROM trade_native_commitment_classification
             WHERE resource_type = NEW.subject_type AND resource_id = NEW.subject_id)
          THEN 'CLASSIFICATION_CHANGED' ELSE 'CLASSIFICATION_ABSENT' END;
      END IF;

      IF reason IS NULL THEN
        SELECT * INTO r FROM trade_order_authority_receipt WHERE receipt_id = NEW.receipt_id;
        IF r.receipt_id IS NULL OR r.tenant_id <> c.tenant_id OR r.binding_id <> c.seller_binding_id
           OR r.binding_version <> c.seller_binding_version THEN
          reason := 'CLASSIFICATION_CONFLICT';
        END IF;
      END IF;

      IF reason IS NULL THEN
        SELECT * INTO latest FROM trade_commerce_profile_observation
          WHERE digital_estate_id = c.digital_estate_id AND engine_instance_id = c.trade_engine_instance_id
            AND market_id = c.market_id
          ORDER BY observed_at DESC, observation_id DESC LIMIT 1;
        IF latest.observation_id IS NULL OR latest.outcome <> 'ATTESTED'
           OR latest.commerce_profile_id <> c.commerce_profile_id
           OR latest.profile_revision < c.profile_revision
           OR latest.commerce_model <> c.commerce_model OR latest.tenant_id <> c.tenant_id
           OR latest.expires_at <= clock_timestamp() THEN
          reason := 'PROFILE_NOT_ACTIVE';
        END IF;
      END IF;

      -- Decision 6: B2B consumes the buyer receipt and converts its spend
      -- reservation here, in the order's own transaction, or is refused.
      IF reason IS NULL AND c.commerce_model = 'B2B' THEN
        SELECT f.reason, f.buyer_receipt INTO reason, buyer_receipt FROM trade_commit_fence_b2b(NEW, c, r) f;
      END IF;

      INSERT INTO trade_commit_fence_decision (subject_type, subject_id, receipt_id, classification_id, commerce_model,
          outcome, enforcement_mode, enforcement_revision, buyer_receipt_id)
        VALUES (NEW.subject_type, NEW.subject_id, NEW.receipt_id, c.classification_id, c.commerce_model,
          coalesce(reason, 'ALLOWED'), gate.mode, gate.revision, buyer_receipt);

      IF reason IS NOT NULL AND gate.mode = 'ENFORCED' THEN
        RAISE EXCEPTION 'Decision 8 denied (%): %', reason, CASE reason
          WHEN 'CLASSIFICATION_ABSENT' THEN 'no native commitment without a known classification'
          WHEN 'CLASSIFICATION_CHANGED' THEN 'the classification was retired; governed reconciliation and reauthorization are required'
          WHEN 'CLASSIFICATION_CONFLICT' THEN 'the classification and the seller receipt disagree'
          WHEN 'PROFILE_NOT_ACTIVE' THEN 'no current CP commerce profile attestation for the classification'
          WHEN 'BUYER_AUTHORITY_ABSENT' THEN 'a B2B commitment requires the buyer-authority receipt and its spend reservation in this transaction'
          ELSE 'the buyer-authority receipt cannot be consumed with its spend reservation' END;
      END IF;
      RETURN NULL;
    END $$;`)
  }

  async down(): Promise<void> {
    // Dropping buyer receipts or their consumption would erase the B2B commit evidence.
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'Decision 6 B2B regime rollback requires a reviewed decision; set the gate to SHADOW instead'; END $$;`,
    )
  }
}
