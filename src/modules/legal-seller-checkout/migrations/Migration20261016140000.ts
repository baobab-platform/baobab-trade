import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-039 Trade-A TA-05: Trade's receipt of one CP order-authority
 * decision for one operation on one attributed native record.
 *
 * A receipt binds the CP decision (decision id, mandate, legal entity, lease)
 * to the attribution it was obtained for and the exact operation class and
 * reference. It is evidence that Trade enforced the decision at the execution
 * point; TA-07 consumes it, at most once, at the persistence commit point.
 *
 * The database refuses:
 * - a receipt whose binding, digest, currency, scope or subject differs from
 *   its attribution;
 * - a lease longer than 30 s from receipt, or already expired at insert;
 * - a replayed decision id, or a second live receipt for one operation
 *   reference;
 * - any rewrite other than the single consumption TA-07 will perform, and
 *   DELETE or TRUNCATE.
 */
export class Migration20261016140000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`CREATE TABLE trade_order_authority_receipt (
      receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      attribution_id uuid NOT NULL REFERENCES trade_commitment_attribution (attribution_id),
      operation_class text NOT NULL CHECK (operation_class IN
        ('trade.order.commit', 'trade.order.create', 'trade.draft-order.finalize')),
      operation_reference text NOT NULL CHECK (length(operation_reference) BETWEEN 1 AND 256
        AND operation_reference ~ '^[\\x21-\\x7E]+$'),
      decision_id uuid NOT NULL UNIQUE,
      binding_id uuid NOT NULL,
      binding_version integer NOT NULL CHECK (binding_version >= 1),
      native_configuration_digest text NOT NULL CHECK (native_configuration_digest ~ '^[0-9a-f]{64}$'),
      currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      context_id uuid NOT NULL,
      tenant_id text NOT NULL,
      operating_organisation_id uuid NOT NULL,
      market text NOT NULL,
      mandate_id uuid NOT NULL,
      responsible_legal_entity_id text NOT NULL CHECK (length(btrim(responsible_legal_entity_id)) > 0),
      policy_reference text NOT NULL CHECK (length(btrim(policy_reference)) > 0),
      evaluated_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL,
      lease_expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (evaluated_at <= received_at + interval '1 second'),
      CHECK (lease_expires_at > received_at AND lease_expires_at <= received_at + interval '30 seconds'),
      CHECK (lease_expires_at <= evaluated_at + interval '30 seconds'),
      CHECK (consumed_at IS NULL OR consumed_at <= lease_expires_at));
    -- One live (unconsumed) receipt per operation; a consumed one is history.
    CREATE UNIQUE INDEX trade_order_authority_receipt_one_live
      ON trade_order_authority_receipt (operation_class, operation_reference) WHERE consumed_at IS NULL;
    CREATE INDEX trade_order_authority_receipt_attribution
      ON trade_order_authority_receipt (attribution_id, recorded_at DESC);`)
    this
      .addSql(`CREATE FUNCTION trade_order_authority_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.consumed_at IS NOT NULL OR NEW.lease_expires_at <= clock_timestamp() THEN
          RAISE EXCEPTION 'Trade-A denied: a new receipt must be current and unconsumed';
        END IF;
        PERFORM 1 FROM trade_commitment_attribution a
          WHERE a.attribution_id = NEW.attribution_id
            AND a.binding_id = NEW.binding_id AND a.binding_version = NEW.binding_version
            AND a.native_configuration_digest = NEW.native_configuration_digest
            AND a.currency = NEW.currency AND a.context_id = NEW.context_id
            AND a.tenant_id = NEW.tenant_id AND a.operating_organisation_id = NEW.operating_organisation_id
            AND a.market = NEW.market
            -- The application is not the only writer of receipt evidence.
            -- Bind each catalogued class to its native attribution kind here
            -- too: matching scope/binding alone cannot turn a cart, order or
            -- draft into a different commitment. Unknown classes match NULL
            -- (and are independently rejected by the table CHECK).
            AND a.subject_type = CASE NEW.operation_class
              WHEN 'trade.order.commit' THEN 'cart'
              WHEN 'trade.order.create' THEN 'order'
              WHEN 'trade.draft-order.finalize' THEN 'draft_order'
              ELSE NULL
            END;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Trade-A denied: the decision does not match its attribution';
        END IF;
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' THEN
        -- Only the single consumption (TA-07 commit fence) may change a receipt.
        -- The database, not the caller, stamps the consumption time.
        IF OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
           AND (to_jsonb(NEW) - 'consumed_at') = (to_jsonb(OLD) - 'consumed_at') THEN
          NEW.consumed_at := clock_timestamp();
          IF NEW.consumed_at > OLD.lease_expires_at THEN
            RAISE EXCEPTION 'Trade-A denied: the order-authority lease expired before consumption';
          END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Trade-A denied: an order-authority receipt is consumed at most once and never rewritten';
      END IF;
      RAISE EXCEPTION 'Trade-A: order-authority receipt history is append-only';
    END $$;`)
    this.addSql(`CREATE TRIGGER trade_order_authority_receipt_guard
      BEFORE INSERT OR UPDATE OR DELETE ON trade_order_authority_receipt
      FOR EACH ROW EXECUTE FUNCTION trade_order_authority_receipt_guard();
    CREATE TRIGGER trade_order_authority_receipt_no_truncate
      BEFORE TRUNCATE ON trade_order_authority_receipt
      FOR EACH STATEMENT EXECUTE FUNCTION trade_order_authority_receipt_guard();`)
  }

  async down(): Promise<void> {
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'Trade-A receipt rollback requires reviewed history preservation'; END $$;`,
    )
  }
}
