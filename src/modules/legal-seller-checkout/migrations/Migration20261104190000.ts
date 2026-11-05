import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * CAA-06b. Runs after the legal-seller-checkout module TA-07 and
 * Decision 9 migrations. The receipt is server-derived from current IAM/CP and Trade policy
 * authority; it is not a bearer credential. Consumption may occur only with
 * the same native order, seller commitment, spend conversion, and outbox row.
 * This does NOT activate the existing SHADOW classification fence.
 */
export class Migration20261104190000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE trade_buyer_authority_receipt (
        receipt_id uuid PRIMARY KEY,
        payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
        evaluated_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CHECK (expires_at > evaluated_at AND expires_at <= evaluated_at + interval '60 seconds')
      );
      CREATE TABLE trade_buyer_authority_consumption (
        receipt_id uuid PRIMARY KEY REFERENCES trade_buyer_authority_receipt(receipt_id),
        seller_receipt_id uuid NOT NULL UNIQUE REFERENCES trade_order_authority_receipt(receipt_id),
        spend_reservation_id text NOT NULL UNIQUE REFERENCES b2b_spend_reservation(id),
        operation_reference text NOT NULL,
        order_id text NOT NULL UNIQUE,
        event_id text NOT NULL UNIQUE,
        consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );

      CREATE FUNCTION trade_buyer_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'CAA-06b: authority and consumption history are immutable';
      END $$;
      CREATE TRIGGER trade_buyer_receipt_immutable BEFORE UPDATE OR DELETE
        ON trade_buyer_authority_receipt FOR EACH ROW EXECUTE FUNCTION trade_buyer_receipt_immutable();
      CREATE TRIGGER trade_buyer_receipt_no_truncate BEFORE TRUNCATE
        ON trade_buyer_authority_receipt FOR EACH STATEMENT EXECUTE FUNCTION trade_buyer_receipt_immutable();
      CREATE TRIGGER trade_buyer_consumption_immutable BEFORE UPDATE OR DELETE
        ON trade_buyer_authority_consumption FOR EACH ROW EXECUTE FUNCTION trade_buyer_receipt_immutable();
      CREATE TRIGGER trade_buyer_consumption_no_truncate BEFORE TRUNCATE
        ON trade_buyer_authority_consumption FOR EACH STATEMENT EXECUTE FUNCTION trade_buyer_receipt_immutable();

      CREATE FUNCTION trade_buyer_authority_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT (NEW.payload ?& ARRAY[
             'receipt_id','context_id','decision_id','correlation_id',
             'operation','operation_reference','actor_principal_id','tenant_id',
             'canonical_organisation_id','buyer_organisation_id','buyer_membership_id',
             'membership_revision','market_id','resource_id','resource_version',
             'transaction_digest','amount_minor','currency','valuation_digest',
             'policy_revision','spend_reservation_id','spend_hold_revision',
             'seller_legal_entity_id','seller_binding_reference',
             'evaluated_at','expires_at'
           ])
           OR NEW.evaluated_at > clock_timestamp()
           OR NEW.payload->>'receipt_id' IS DISTINCT FROM NEW.receipt_id::text
           OR (NEW.payload->>'evaluated_at')::timestamptz IS DISTINCT FROM NEW.evaluated_at
           OR (NEW.payload->>'expires_at')::timestamptz IS DISTINCT FROM NEW.expires_at
           OR NEW.expires_at <= clock_timestamp()
           OR coalesce(NEW.payload->>'operation','') NOT IN
              ('trade.order.commit','trade.order.create','trade.draft-order.finalize')
           OR coalesce(NEW.payload->>'operation_reference','') = ''
           OR NOT coalesce(NEW.payload->>'valuation_digest' ~ '^sha256:[0-9a-f]{64}$',false)
           OR NOT coalesce(NEW.payload->>'transaction_digest' ~ '^sha256:[0-9a-f]{64}$',false)
           OR NOT coalesce(NEW.payload->>'amount_minor' ~ '^[1-9][0-9]*$',false)
           OR NOT coalesce(NEW.payload->>'currency' ~ '^[A-Z]{3}$',false)
        THEN
          RAISE EXCEPTION 'CAA-06b: incomplete or expired buyer authority';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trade_buyer_authority_receipt_guard BEFORE INSERT
        ON trade_buyer_authority_receipt FOR EACH ROW
        EXECUTE FUNCTION trade_buyer_authority_receipt_guard();

      CREATE FUNCTION trade_buyer_authority_consumption_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        buyer trade_buyer_authority_receipt%ROWTYPE;
        seller trade_order_authority_receipt%ROWTYPE;
        reserve b2b_spend_reservation%ROWTYPE;
        member b2b_buyer_membership%ROWTYPE;
        native_order "order"%ROWTYPE;
        event_row event_outbox%ROWTYPE;
        xid_current bigint := txid_current() % 4294967296;
      BEGIN
        SELECT * INTO buyer FROM trade_buyer_authority_receipt
          WHERE receipt_id=NEW.receipt_id FOR UPDATE;
        SELECT * INTO seller FROM trade_order_authority_receipt
          WHERE receipt_id=NEW.seller_receipt_id FOR SHARE;
        SELECT * INTO reserve FROM b2b_spend_reservation
          WHERE id=NEW.spend_reservation_id FOR SHARE;
        SELECT * INTO member FROM b2b_buyer_membership
          WHERE id=buyer.payload->>'buyer_membership_id' FOR SHARE;
        SELECT * INTO native_order FROM "order" WHERE id=NEW.order_id FOR SHARE;
        SELECT * INTO event_row FROM event_outbox WHERE event_id=NEW.event_id;
        IF buyer.receipt_id IS NULL OR seller.receipt_id IS NULL
          OR reserve.id IS NULL OR member.id IS NULL
          OR member.organisation_id IS DISTINCT FROM reserve.organisation_id
          OR member.principal_id IS DISTINCT FROM buyer.payload->>'actor_principal_id'
          OR reserve.tenant_id IS DISTINCT FROM seller.tenant_id
          OR reserve.purchase_reference IS DISTINCT FROM buyer.payload->>'resource_id'
          OR native_order.id IS NULL OR event_row.id IS NULL
          OR buyer.expires_at <= clock_timestamp()
          OR seller.consumed_at IS NULL
          OR seller.operation_reference IS DISTINCT FROM NEW.operation_reference
          OR buyer.payload->>'operation_reference' IS DISTINCT FROM NEW.operation_reference
          OR buyer.payload->>'operation' IS DISTINCT FROM seller.operation_class
          OR buyer.payload->>'seller_legal_entity_id' IS DISTINCT FROM seller.responsible_legal_entity_id
          OR buyer.payload->'seller_binding_reference'->>'binding_id' IS DISTINCT FROM seller.binding_id::text
          OR (buyer.payload->'seller_binding_reference'->>'binding_version')::integer IS DISTINCT FROM seller.binding_version
          OR buyer.payload->>'tenant_id' IS DISTINCT FROM seller.tenant_id
          OR buyer.payload->>'buyer_organisation_id' IS DISTINCT FROM reserve.organisation_id
          OR buyer.payload->>'buyer_membership_id' IS DISTINCT FROM reserve.membership_id
          OR buyer.payload->>'actor_principal_id' IS DISTINCT FROM reserve.submitted_by_principal_id
          OR buyer.payload->>'transaction_digest' IS DISTINCT FROM reserve.transaction_digest
          OR (buyer.payload->>'resource_version')::integer IS DISTINCT FROM reserve.resource_version
          OR (buyer.payload->>'spend_hold_revision')::integer IS DISTINCT FROM reserve.hold_revision
          OR (buyer.payload->>'amount_minor')::numeric IS DISTINCT FROM reserve.amount_minor
          OR buyer.payload->>'currency' IS DISTINCT FROM reserve.currency_code
          OR reserve.status <> 'COMMITTED'
          OR member.status <> 'ACTIVE'
          OR member.revision <> (buyer.payload->>'membership_revision')::integer
          OR (member.effective_from IS NOT NULL AND member.effective_from > clock_timestamp())
          OR (member.effective_until IS NOT NULL AND member.effective_until <= clock_timestamp())
          OR native_order.is_draft_order
          OR upper(native_order.currency_code) IS DISTINCT FROM buyer.payload->>'currency'
          OR native_order.xmin::text::bigint <> xid_current
          OR event_row.xmin::text::bigint <> xid_current
          OR event_row.event_type <> 'com.baobab-platform.trade.order.placed.v1'
          OR event_row.status <> 'PENDING'
          OR event_row.tenant_id IS DISTINCT FROM buyer.payload->>'tenant_id'
          OR event_row.owner_legal_entity_id IS DISTINCT FROM seller.responsible_legal_entity_id
          OR event_row.idempotency_key IS DISTINCT FROM event_row.envelope->>'idempotencykey'
          OR event_row.envelope->>'type' IS DISTINCT FROM event_row.event_type
          OR event_row.envelope->>'dataschema' IS DISTINCT FROM
             'https://contracts.baobab-platform.com/erp/v1/commerce-order-consequence.schema.json'
          OR event_row.envelope->'data'->>'legal_entity_id' IS DISTINCT FROM seller.responsible_legal_entity_id
          OR event_row.envelope->'data'->>'currency' IS DISTINCT FROM upper(native_order.currency_code)
          OR (event_row.envelope->'data'->>'order_version')::integer IS DISTINCT FROM native_order.version
          OR event_row.envelope->'data'->>'customer_id' IS DISTINCT FROM native_order.customer_id
          OR event_row.envelope->>'source' <> 'urn:baobab-platform:service:baobab-trade'
          OR event_row.envelope->>'id' IS DISTINCT FROM NEW.event_id
          OR event_row.envelope->>'tenantid' IS DISTINCT FROM seller.tenant_id
          OR event_row.envelope->'data'->>'commerce_order_id' IS DISTINCT FROM NEW.order_id
          OR NOT EXISTS (
            SELECT 1 FROM trade_order_commitment k
             WHERE k.receipt_id=seller.receipt_id AND k.order_id=NEW.order_id
               AND k.xmin::text::bigint=xid_current)
          OR NOT EXISTS (
            SELECT 1 FROM b2b_spend_ledger_entry l
             WHERE l.reservation_id=reserve.id AND l.entry_kind='COMMIT'
               AND l.commitment_reference=NEW.order_id
               AND l.amount_minor=reserve.amount_minor AND l.xmin::text::bigint=xid_current)
        THEN
          RAISE EXCEPTION 'CAA-06b: buyer/native/spend/outbox transaction not proven';
        END IF;
        NEW.consumed_at := clock_timestamp();
        RETURN NEW;
      END $$;
      CREATE TRIGGER trade_buyer_authority_consumption_guard BEFORE INSERT
        ON trade_buyer_authority_consumption FOR EACH ROW
        EXECUTE FUNCTION trade_buyer_authority_consumption_guard();
    `)
    // Preserve original B2C and classification conditions; extend only
    // B2B admission to same-XID receipt consumption. Gate remains SHADOW.
    this
      .addSql(`CREATE OR REPLACE FUNCTION trade_order_commitment_classification() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE c trade_native_commitment_classification%ROWTYPE; r trade_order_authority_receipt%ROWTYPE;
            latest trade_commerce_profile_observation%ROWTYPE; gate trade_commit_fence_enforcement%ROWTYPE;
            reason text;
    BEGIN
      -- FOR SHARE serializes the verdict with a gate change: an uncommitted
      -- switch blocks this check until it commits, and this check holds off a
      -- switch until the order's transaction ends. There is no window in which
      -- an order commits under the mode it was not evaluated in.
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

      -- Until the CAA-06b composition consumes the buyer-authority receipt and
      -- its spend reservation here, no B2B commitment passes.
      IF reason IS NULL AND c.commerce_model = 'B2B' THEN
        -- Buyer consumption guard previously proved current native transaction.
        IF NOT EXISTS (
          SELECT 1 FROM trade_buyer_authority_consumption bc
          JOIN trade_buyer_authority_receipt br ON br.receipt_id=bc.receipt_id
          WHERE bc.seller_receipt_id=NEW.receipt_id AND bc.order_id=NEW.order_id
            AND bc.operation_reference=r.operation_reference
            AND br.expires_at > clock_timestamp()
            AND br.payload->>'operation' = r.operation_class
            AND br.payload->>'operation_reference' = r.operation_reference
            AND br.payload->>'tenant_id' = c.tenant_id
            AND br.payload->>'buyer_organisation_id' = c.buyer_organisation_id
            AND br.payload->>'buyer_membership_id' = c.buyer_membership_id
            AND br.payload->>'currency' = r.currency
        ) THEN reason := 'BUYER_AUTHORITY_ABSENT'; END IF;
      END IF;

      INSERT INTO trade_commit_fence_decision (subject_type, subject_id, receipt_id, classification_id, commerce_model,
          outcome, enforcement_mode, enforcement_revision)
        VALUES (NEW.subject_type, NEW.subject_id, NEW.receipt_id, c.classification_id, c.commerce_model,
          coalesce(reason, 'ALLOWED'), gate.mode, gate.revision);

      IF reason IS NOT NULL AND gate.mode = 'ENFORCED' THEN
        RAISE EXCEPTION 'Decision 8 denied (%): %', reason, CASE reason
          WHEN 'CLASSIFICATION_ABSENT' THEN 'no native commitment without a known classification'
          WHEN 'CLASSIFICATION_CHANGED' THEN 'the classification was retired; governed reconciliation and reauthorization are required'
          WHEN 'CLASSIFICATION_CONFLICT' THEN 'the classification and the seller receipt disagree'
          WHEN 'PROFILE_NOT_ACTIVE' THEN 'no current CP commerce profile attestation for the classification'
          ELSE 'a B2B commitment requires the buyer-authority receipt and its spend reservation in this transaction' END;
      END IF;
      RETURN NULL;
    END $$;`)
  }

  async down(): Promise<void> {
    // An automatic rollback must not erase evidence or reopen order authority.
    this.addSql(
      "DO $$ BEGIN RAISE EXCEPTION 'CAA-06b rollback requires reviewed history preservation'; END $$;",
    )
  }
}
