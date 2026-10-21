import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { resolveNativeCheckoutEnvironment } from "../../../baobab/orders/native-cart-legal-seller"

/**
 * ADR-SHARED-039 Trade-A TA-07: PostgreSQL provenance and commit protection
 * for native order commitment. Whatever path writes the row (Medusa workflow,
 * module service or direct SQL), the database decides.
 *
 * Medusa 2.21.2 writes an order, its line items and item rows in ONE
 * transaction that carries no cart id; the cart link and completed_at follow
 * in later transactions. So:
 *
 * 1. Order INSERT (non-draft) consumes exactly one live trade.order.commit
 *    receipt whose attributed, open cart has the order's sales channel,
 *    region, currency, customer and email, and records an append-only
 *    commitment. No candidate, or candidates on more than one cart, is
 *    refused: Trade never guesses which authority applies. At COMMIT the
 *    order's lines must equal that cart's lines (variant, quantity, unit
 *    price), so a receipt cannot authorise different contents.
 * 2. Draft finalisation (is_draft_order true -> false) consumes a live
 *    trade.draft-order.finalize receipt attributed to that draft.
 * 3. Cart completion (completed_at NULL -> NOT NULL) requires a commitment
 *    for the cart whose order still exists. Saga compensation hard-deletes
 *    the order, so a retry needs a new receipt.
 * 4. A receipt is consumed only inside these fences (never by a direct
 *    UPDATE), and a commitment is written only by them.
 *
 * Persistence posture. ENFORCED applies the rules to every row: an order or
 * completion with no receipt is refused, which supersedes the P0-04B-03
 * never-activated-cart exemption ("absence of a seller binding is grounds
 * for denial"). SANDBOX, recorded only when this migration runs under an
 * explicit local profile (development/test/integration), still fences every
 * record that carries Trade-A attribution or a matching receipt but leaves
 * unattributed synthetic fixtures to native Medusa. The posture can only move
 * SANDBOX -> ENFORCED. A session may opt into ENFORCED, never out of it.
 */
export class Migration20261021090000 extends Migration {
  async up(): Promise<void> {
    const profile = resolveNativeCheckoutEnvironment({
      node: process.env.NODE_ENV,
      baobab: process.env.BAOBAB_ENVIRONMENT,
      deployment: process.env.BAOBAB_DEPLOYMENT_ENV,
    })
    const posture = profile.production || profile.staging ? "ENFORCED" : "SANDBOX"

    this.addSql(`DO $$ BEGIN
      IF to_regclass('public.order') IS NULL OR to_regclass('public.cart') IS NULL
         OR to_regclass('public.order_item') IS NULL OR to_regclass('public.cart_line_item') IS NULL THEN
        RAISE EXCEPTION 'TA-07 requires the native Medusa order and cart tables';
      END IF;
    END $$;`)

    this.addSql(`CREATE TABLE trade_a_persistence_posture (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      posture text NOT NULL CHECK (posture IN ('SANDBOX', 'ENFORCED')),
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE FUNCTION trade_a_persistence_posture_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
      IF TG_OP = 'UPDATE' AND OLD.posture = 'SANDBOX' AND NEW.posture = 'ENFORCED'
         AND NEW.singleton = OLD.singleton THEN
        NEW.recorded_at := clock_timestamp();
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Trade-A: persistence posture only moves from SANDBOX to ENFORCED';
    END $$;
    CREATE TRIGGER trade_a_persistence_posture_guard
      BEFORE INSERT OR UPDATE OR DELETE ON trade_a_persistence_posture
      FOR EACH ROW EXECUTE FUNCTION trade_a_persistence_posture_guard();
    CREATE TRIGGER trade_a_persistence_posture_no_truncate
      BEFORE TRUNCATE ON trade_a_persistence_posture
      FOR EACH STATEMENT EXECUTE FUNCTION trade_a_persistence_posture_guard();`)
    this.addSql(`INSERT INTO trade_a_persistence_posture (posture) VALUES ('${posture}');`)
    this
      .addSql(`CREATE FUNCTION trade_a_persistence_enforced() RETURNS boolean LANGUAGE sql STABLE AS $$
      -- A missing posture row is ENFORCED; a session can only strengthen it.
      SELECT current_setting('baobab.trade_a_posture', true) = 'ENFORCED'
          OR coalesce((SELECT posture FROM trade_a_persistence_posture), 'ENFORCED') = 'ENFORCED'
    $$;`)

    // Receipts are consumed only by the commit fences below (trigger depth >= 2).
    this
      .addSql(`CREATE OR REPLACE FUNCTION trade_order_authority_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
        -- TA-07: only a commit fence consumes (or voids) a receipt, once,
        -- and the database stamps the time.
        IF pg_trigger_depth() >= 2
           AND OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
           AND (to_jsonb(NEW) - 'consumed_at') = (to_jsonb(OLD) - 'consumed_at') THEN
          NEW.consumed_at := clock_timestamp();
          IF NEW.consumed_at > OLD.lease_expires_at THEN
            RAISE EXCEPTION 'Trade-A denied: the order-authority lease expired before consumption';
          END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Trade-A denied: an order-authority receipt is consumed only at the commit fence, at most once';
      END IF;
      RAISE EXCEPTION 'Trade-A: order-authority receipt history is append-only';
    END $$;`)

    this.addSql(`CREATE TABLE trade_order_commitment (
      commitment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      receipt_id uuid NOT NULL UNIQUE REFERENCES trade_order_authority_receipt (receipt_id),
      operation_class text NOT NULL CHECK (operation_class IN ('trade.order.commit', 'trade.draft-order.finalize')),
      subject_type text NOT NULL CHECK (subject_type IN ('cart', 'draft_order')),
      subject_id text NOT NULL CHECK (length(btrim(subject_id)) BETWEEN 1 AND 200),
      -- No foreign key: compensation hard-deletes the order, the history stays.
      order_id text NOT NULL CHECK (length(btrim(order_id)) BETWEEN 1 AND 200),
      committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((operation_class = 'trade.order.commit' AND subject_type = 'cart')
          OR (operation_class = 'trade.draft-order.finalize' AND subject_type = 'draft_order'
              AND subject_id = order_id)));
    CREATE INDEX trade_order_commitment_subject
      ON trade_order_commitment (subject_type, subject_id, committed_at DESC);
    CREATE INDEX trade_order_commitment_order ON trade_order_commitment (order_id);
    CREATE FUNCTION trade_order_commitment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      -- Written only by the order commit fence; never forged, rewritten or erased.
      IF TG_OP = 'INSERT' AND pg_trigger_depth() >= 2 THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'Trade-A: order commitments are written only by the commit fence and are append-only';
    END $$;
    CREATE TRIGGER trade_order_commitment_guard
      BEFORE INSERT OR UPDATE OR DELETE ON trade_order_commitment
      FOR EACH ROW EXECUTE FUNCTION trade_order_commitment_guard();
    CREATE TRIGGER trade_order_commitment_no_truncate
      BEFORE TRUNCATE ON trade_order_commitment
      FOR EACH STATEMENT EXECUTE FUNCTION trade_order_commitment_guard();`)

    // At COMMIT, a cart commitment's order must carry exactly the cart's lines and scope.
    this
      .addSql(`CREATE FUNCTION trade_order_commitment_content() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE c cart%ROWTYPE; o "order"%ROWTYPE; differs boolean;
    BEGIN
      IF NEW.operation_class <> 'trade.order.commit' THEN RETURN NULL; END IF;
      SELECT * INTO o FROM "order" WHERE id = NEW.order_id;
      SELECT * INTO c FROM cart WHERE id = NEW.subject_id;
      IF o.id IS NULL OR c.id IS NULL
         OR o.sales_channel_id IS DISTINCT FROM c.sales_channel_id
         OR o.region_id IS DISTINCT FROM c.region_id
         OR upper(o.currency_code) <> upper(c.currency_code)
         OR o.customer_id IS DISTINCT FROM c.customer_id
         OR o.email IS DISTINCT FROM c.email THEN
        RAISE EXCEPTION 'Trade-A denied: the committed order does not match its authorised cart';
      END IF;
      SELECT EXISTS (
        (SELECT li.variant_id, oi.quantity::numeric, li.unit_price
           FROM order_item oi JOIN order_line_item li ON li.id = oi.item_id
          WHERE oi.order_id = o.id AND oi.version = o.version
            AND oi.deleted_at IS NULL AND li.deleted_at IS NULL
         EXCEPT ALL
         SELECT variant_id, quantity::numeric, unit_price
           FROM cart_line_item WHERE cart_id = c.id AND deleted_at IS NULL)
        UNION ALL
        (SELECT variant_id, quantity::numeric, unit_price
           FROM cart_line_item WHERE cart_id = c.id AND deleted_at IS NULL
         EXCEPT ALL
         SELECT li.variant_id, oi.quantity::numeric, li.unit_price
           FROM order_item oi JOIN order_line_item li ON li.id = oi.item_id
          WHERE oi.order_id = o.id AND oi.version = o.version
            AND oi.deleted_at IS NULL AND li.deleted_at IS NULL)) INTO differs;
      IF differs THEN
        RAISE EXCEPTION 'Trade-A denied: the committed order lines differ from the authorised cart';
      END IF;
      RETURN NULL;
    END $$;
    CREATE CONSTRAINT TRIGGER trade_order_commitment_content AFTER INSERT
      ON trade_order_commitment DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION trade_order_commitment_content();`)

    this.addSql(`CREATE FUNCTION trade_a_order_commit_fence() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE chosen uuid; subject text; carts integer; enforced boolean := trade_a_persistence_enforced();
    BEGIN
      IF TG_OP = 'INSERT' THEN
        -- A draft is not a commitment; its finalisation is fenced below.
        IF NEW.is_draft_order THEN RETURN NEW; END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(
          'trade-a/order-commit/' || coalesce(NEW.sales_channel_id, '') || '/' || upper(NEW.currency_code), 0));
        SELECT count(DISTINCT a.subject_id) INTO carts
          FROM trade_order_authority_receipt r
          JOIN trade_commitment_attribution a ON a.attribution_id = r.attribution_id
          JOIN cart c ON c.id = a.subject_id
         WHERE r.operation_class = 'trade.order.commit' AND a.subject_type = 'cart'
           AND r.consumed_at IS NULL AND r.lease_expires_at > clock_timestamp()
           AND c.deleted_at IS NULL AND c.completed_at IS NULL
           AND c.sales_channel_id IS NOT DISTINCT FROM NEW.sales_channel_id
           AND c.region_id IS NOT DISTINCT FROM NEW.region_id
           AND upper(c.currency_code) = upper(NEW.currency_code) AND r.currency = upper(NEW.currency_code)
           AND c.customer_id IS NOT DISTINCT FROM NEW.customer_id
           AND c.email IS NOT DISTINCT FROM NEW.email;
        IF carts = 0 THEN
          IF enforced THEN
            RAISE EXCEPTION 'Trade-A denied: no current trade.order.commit authority for this order';
          END IF;
          RETURN NEW;
        END IF;
        IF carts > 1 THEN
          RAISE EXCEPTION 'Trade-A denied: order authority is ambiguous between carts';
        END IF;
        SELECT r.receipt_id, a.subject_id INTO chosen, subject
          FROM trade_order_authority_receipt r
          JOIN trade_commitment_attribution a ON a.attribution_id = r.attribution_id
          JOIN cart c ON c.id = a.subject_id
         WHERE r.operation_class = 'trade.order.commit' AND a.subject_type = 'cart'
           AND r.consumed_at IS NULL AND r.lease_expires_at > clock_timestamp()
           AND c.deleted_at IS NULL AND c.completed_at IS NULL
           AND c.sales_channel_id IS NOT DISTINCT FROM NEW.sales_channel_id
           AND c.region_id IS NOT DISTINCT FROM NEW.region_id
           AND upper(c.currency_code) = upper(NEW.currency_code) AND r.currency = upper(NEW.currency_code)
           AND c.customer_id IS NOT DISTINCT FROM NEW.customer_id
           AND c.email IS NOT DISTINCT FROM NEW.email
         ORDER BY r.recorded_at DESC, r.receipt_id DESC LIMIT 1
         FOR UPDATE OF r;
        UPDATE trade_order_authority_receipt SET consumed_at = clock_timestamp() WHERE receipt_id = chosen;
        -- Older live receipts for the same cart are voided, never left for reuse.
        UPDATE trade_order_authority_receipt r SET consumed_at = clock_timestamp()
          FROM trade_commitment_attribution a
         WHERE a.attribution_id = r.attribution_id AND a.subject_type = 'cart' AND a.subject_id = subject
           AND r.operation_class = 'trade.order.commit' AND r.consumed_at IS NULL;
        INSERT INTO trade_order_commitment (receipt_id, operation_class, subject_type, subject_id, order_id)
          VALUES (chosen, 'trade.order.commit', 'cart', subject, NEW.id);
        RETURN NEW;
      END IF;
      -- UPDATE: draft finalisation.
      IF OLD.is_draft_order AND NOT NEW.is_draft_order THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('trade-a/draft-finalize/' || NEW.id, 0));
        SELECT r.receipt_id INTO chosen
          FROM trade_order_authority_receipt r
          JOIN trade_commitment_attribution a ON a.attribution_id = r.attribution_id
         WHERE r.operation_class = 'trade.draft-order.finalize'
           AND a.subject_type = 'draft_order' AND a.subject_id = NEW.id
           AND r.consumed_at IS NULL AND r.lease_expires_at > clock_timestamp()
           AND r.currency = upper(NEW.currency_code)
         ORDER BY r.recorded_at DESC, r.receipt_id DESC LIMIT 1
         FOR UPDATE OF r;
        IF chosen IS NULL THEN
          IF enforced OR EXISTS (SELECT 1 FROM trade_commitment_attribution
               WHERE subject_type = 'draft_order' AND subject_id = NEW.id) THEN
            RAISE EXCEPTION 'Trade-A denied: no current trade.draft-order.finalize authority for this draft';
          END IF;
          RETURN NEW;
        END IF;
        UPDATE trade_order_authority_receipt SET consumed_at = clock_timestamp() WHERE receipt_id = chosen;
        UPDATE trade_order_authority_receipt r SET consumed_at = clock_timestamp()
          FROM trade_commitment_attribution a
         WHERE a.attribution_id = r.attribution_id AND a.subject_type = 'draft_order' AND a.subject_id = NEW.id
           AND r.operation_class = 'trade.draft-order.finalize' AND r.consumed_at IS NULL;
        INSERT INTO trade_order_commitment (receipt_id, operation_class, subject_type, subject_id, order_id)
          VALUES (chosen, 'trade.draft-order.finalize', 'draft_order', NEW.id, NEW.id);
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trade_a_order_commit_fence BEFORE INSERT OR UPDATE OF is_draft_order ON "order"
      FOR EACH ROW EXECUTE FUNCTION trade_a_order_commit_fence();`)

    this.addSql(`CREATE FUNCTION trade_a_cart_commit_fence() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM trade_order_commitment k JOIN "order" o ON o.id = k.order_id
             WHERE k.operation_class = 'trade.order.commit' AND k.subject_id = NEW.id
               AND o.deleted_at IS NULL) THEN
          RETURN NEW;
        END IF;
        IF trade_a_persistence_enforced() OR EXISTS (SELECT 1 FROM trade_commitment_attribution
             WHERE subject_type = 'cart' AND subject_id = NEW.id) THEN
          RAISE EXCEPTION 'Trade-A denied: cart completion requires a committed, authorised order';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trade_a_cart_commit_fence BEFORE UPDATE OF completed_at ON cart
      FOR EACH ROW EXECUTE FUNCTION trade_a_cart_commit_fence();`)
  }

  async down(): Promise<void> {
    // Removing the fences would reopen native order commitment to unauthorised writes.
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'Trade-A commit-fence rollback requires reviewed history preservation'; END $$;`,
    )
  }
}
