import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * CAA-06b. The receipt is server-derived from current IAM/CP and Trade policy
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
        IF NEW.payload->>'receipt_id' IS DISTINCT FROM NEW.receipt_id::text
           OR (NEW.payload->>'evaluated_at')::timestamptz IS DISTINCT FROM NEW.evaluated_at
           OR (NEW.payload->>'expires_at')::timestamptz IS DISTINCT FROM NEW.expires_at
           OR NEW.expires_at <= clock_timestamp()
           OR NEW.payload->>'operation' NOT IN
              ('trade.order.commit','trade.order.create','trade.draft-order.finalize')
           OR coalesce(NEW.payload->>'operation_reference','') = ''
           OR NEW.payload->>'valuation_digest' !~ '^sha256:[0-9a-f]{64}$'
           OR NEW.payload->>'transaction_digest' !~ '^sha256:[0-9a-f]{64}$'
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
  }

  async down(): Promise<void> {
    // An automatic rollback must not erase evidence or reopen order authority.
    this.addSql("DO $$ BEGIN RAISE EXCEPTION 'CAA-06b rollback requires reviewed history preservation'; END $$;")
  }
}
