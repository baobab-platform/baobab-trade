import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * P0-04B-03: commit-point checkout fence. Medusa's completeCartWorkflow is a
 * compensating saga (order, cart completion, reservation, then payment
 * authorization), so no write shares one transaction with order creation.
 * The fence is the cart completed_at NULL→NOT NULL write, which commits before
 * payment authorization: a failure there compensates the order and no payment
 * is authorized (ADR-0014 §10/§11).
 *
 * For a cart whose seller binding was ever activated, completion consumes
 * exactly one current authorization recorded by the validate hook, under the
 * same seller-binding/{cartId} advisory lock that revocation holds. Revocation,
 * a newer binding revision, binding/context expiry or an expired CP/Payments
 * lease all deny at the commit point using clock_timestamp().
 */
export class Migration20261014090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`DO $$ BEGIN
      IF to_regclass('public.cart') IS NULL THEN
        RAISE EXCEPTION 'P0-04B-03 requires the native Medusa cart table';
      END IF;
    END $$;`)
    this.addSql(`CREATE TABLE la05_checkout_authorization (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cart_id text NOT NULL,
      binding_id text NOT NULL REFERENCES native_seller_cart_binding(id),
      binding_revision integer NOT NULL CHECK (binding_revision >= 2),
      context_id text NOT NULL CHECK (length(btrim(context_id)) > 0),
      responsible_legal_entity_id text NOT NULL CHECK (length(btrim(responsible_legal_entity_id)) > 0),
      mandate_id text NOT NULL CHECK (length(btrim(mandate_id)) > 0),
      legal_valid_until timestamptz NOT NULL,
      provider_certification_reference text NOT NULL CHECK (length(btrim(provider_certification_reference)) > 0),
      merchant_activation_reference text NOT NULL CHECK (length(btrim(merchant_activation_reference)) > 0),
      policy_reference text NOT NULL CHECK (length(btrim(policy_reference)) > 0),
      readiness_valid_until timestamptz NOT NULL,
      documentary_valid_until timestamptz NOT NULL,
      lease_expires_at timestamptz NOT NULL,
      idempotency_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      consumed_at timestamptz,
      released_at timestamptz,
      CHECK (lease_expires_at = LEAST(legal_valid_until, readiness_valid_until, documentary_valid_until)),
      CHECK (lease_expires_at <= created_at + interval '31 seconds'),
      CHECK (documentary_valid_until <= created_at + interval '2 seconds'),
      CHECK (idempotency_key = 'native-checkout/' || cart_id),
      CHECK (released_at IS NULL OR consumed_at IS NOT NULL));
    CREATE INDEX la05_checkout_authorization_cart ON la05_checkout_authorization (cart_id, created_at DESC);
    -- Exactly one live consumption per native checkout (ADR-0014 §26–30 replay).
    CREATE UNIQUE INDEX la05_checkout_authorization_single_use ON la05_checkout_authorization (idempotency_key)
      WHERE consumed_at IS NOT NULL AND released_at IS NULL;`)
    this
      .addSql(`CREATE FUNCTION la05_checkout_authorization_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Checkout authorization history cannot be deleted'; END IF;
      IF TG_OP = 'INSERT' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('seller-binding/' || NEW.cart_id, 0));
        IF NEW.consumed_at IS NOT NULL OR NEW.released_at IS NOT NULL
          OR NEW.lease_expires_at <= clock_timestamp() THEN
          RAISE EXCEPTION 'P0-04B-03 denied: a new checkout authorization must be current and unconsumed';
        END IF;
        PERFORM 1 FROM native_seller_cart_binding b
          JOIN cart c ON c.id = b.cart_id AND c.deleted_at IS NULL
          WHERE b.id = NEW.binding_id AND b.cart_id = NEW.cart_id AND b.deleted_at IS NULL
            AND b.status = 'ACTIVE' AND b.revision = NEW.binding_revision
            AND b.context_id = NEW.context_id
            AND b.responsible_legal_entity_id = NEW.responsible_legal_entity_id
            AND b.expires_at > clock_timestamp()
            AND (b.activation_snapshot->'context'->>'expires_at')::timestamptz > clock_timestamp()
            AND c.completed_at IS NULL AND c.sales_channel_id = b.sales_channel_id
            AND c.region_id = b.region_id AND upper(c.currency_code) = b.currency_code
          FOR SHARE OF b, c;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'P0-04B-03 denied: current ACTIVE binding on an open native cart required';
        END IF;
        RETURN NEW;
      END IF;
      -- Only the cart commit-point trigger may consume or release; generated
      -- CRUD or a direct UPDATE cannot rewrite, reuse or un-consume a receipt.
      IF pg_trigger_depth() < 2
        OR (to_jsonb(NEW) - ARRAY['consumed_at','released_at']) IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['consumed_at','released_at'])
        OR NOT (
          (OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND NEW.released_at IS NULL)
          -- Superseded: voided when another receipt for the cart is consumed or released.
          OR (OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND NEW.released_at = NEW.consumed_at)
          OR (OLD.consumed_at IS NOT NULL AND OLD.released_at IS NULL
              AND NEW.consumed_at = OLD.consumed_at AND NEW.released_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'Checkout authorization is append-only';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER la05_checkout_authorization_guard BEFORE INSERT OR UPDATE OR DELETE
      ON la05_checkout_authorization FOR EACH ROW EXECUTE FUNCTION la05_checkout_authorization_guard();`)
    this.addSql(`CREATE FUNCTION la05_checkout_commit_fence() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE authorization_id uuid; at timestamptz := clock_timestamp();
    BEGIN
      IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS NOT NULL
        AND OLD.completed_at IS DISTINCT FROM NEW.completed_at
        AND EXISTS (SELECT 1 FROM native_seller_cart_binding
          WHERE cart_id = NEW.id AND activation_snapshot IS NOT NULL) THEN
        RAISE EXCEPTION 'P0-04B-03 denied: activated cart completion timestamp is immutable';
      END IF;
      IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
        -- Never-activated carts keep the application-level gate only; requiring
        -- a binding for every cart is a separate owner decision.
        IF NOT EXISTS (SELECT 1 FROM native_seller_cart_binding
          WHERE cart_id = NEW.id AND activation_snapshot IS NOT NULL) THEN
          RETURN NEW;
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('seller-binding/' || NEW.id, 0));
        SELECT a.id INTO authorization_id FROM la05_checkout_authorization a
          JOIN native_seller_cart_binding b ON b.id = a.binding_id
          WHERE a.cart_id = NEW.id AND a.consumed_at IS NULL
            AND a.lease_expires_at > clock_timestamp()
            AND b.cart_id = NEW.id AND b.deleted_at IS NULL
            AND b.status = 'ACTIVE' AND b.revision = a.binding_revision
            AND b.context_id = a.context_id
            AND b.responsible_legal_entity_id = a.responsible_legal_entity_id
            AND b.expires_at > clock_timestamp()
            AND (b.activation_snapshot->'context'->>'expires_at')::timestamptz > clock_timestamp()
            AND b.sales_channel_id = NEW.sales_channel_id AND b.region_id = NEW.region_id
            AND b.currency_code = upper(NEW.currency_code)
          ORDER BY a.created_at DESC LIMIT 1
          FOR UPDATE OF a;
        IF authorization_id IS NULL THEN
          RAISE EXCEPTION 'P0-04B-03 denied: current checkout authorization required at cart completion';
        END IF;
        UPDATE la05_checkout_authorization SET consumed_at = at WHERE id = authorization_id;
        -- Exactly one receipt may ever authorize this completion: older ones
        -- recorded by earlier hook runs are voided, never left live for reuse.
        UPDATE la05_checkout_authorization SET consumed_at = at, released_at = at
          WHERE cart_id = NEW.id AND consumed_at IS NULL;
      ELSIF OLD.completed_at IS NOT NULL AND NEW.completed_at IS NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('seller-binding/' || NEW.id, 0));
        -- Saga compensation (e.g. payment authorization failed) reopens the cart.
        -- The consumed receipt is released, never reused; a retry needs a new one.
        UPDATE la05_checkout_authorization SET released_at = at
          WHERE cart_id = NEW.id AND consumed_at IS NOT NULL AND released_at IS NULL;
        UPDATE la05_checkout_authorization SET consumed_at = at, released_at = at
          WHERE cart_id = NEW.id AND consumed_at IS NULL;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER la05_checkout_commit_fence BEFORE UPDATE ON cart
      FOR EACH ROW EXECUTE FUNCTION la05_checkout_commit_fence();`)
    // A BEFORE trigger runs at statement time. Deferred receipt checks run
    // immediately before COMMIT and inspect final rows, including compensation.
    this.addSql(`CREATE FUNCTION la05_checkout_commit_lease() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE receipt la05_checkout_authorization%ROWTYPE;
    BEGIN
      SELECT * INTO receipt FROM la05_checkout_authorization WHERE id = NEW.id;
      IF receipt.released_at IS NOT NULL THEN RETURN NULL; END IF;
      PERFORM 1 FROM native_seller_cart_binding b JOIN cart c ON c.id = receipt.cart_id
        WHERE b.id = receipt.binding_id AND b.cart_id = receipt.cart_id
          AND b.deleted_at IS NULL AND c.deleted_at IS NULL
          AND b.status = 'ACTIVE' AND b.revision = receipt.binding_revision
          AND b.context_id = receipt.context_id
          AND b.responsible_legal_entity_id = receipt.responsible_legal_entity_id
          AND b.expires_at > clock_timestamp()
          AND (b.activation_snapshot->'context'->>'expires_at')::timestamptz > clock_timestamp()
          AND receipt.lease_expires_at > clock_timestamp()
          AND b.sales_channel_id = c.sales_channel_id AND b.region_id = c.region_id
          AND b.currency_code = upper(c.currency_code)
          AND ((receipt.consumed_at IS NULL AND c.completed_at IS NULL)
            OR (receipt.consumed_at IS NOT NULL AND c.completed_at IS NOT NULL));
      IF NOT FOUND THEN
        RAISE EXCEPTION 'P0-04B-03 denied: checkout authority expired or changed before COMMIT';
      END IF;
      RETURN NULL;
    END $$;
    CREATE CONSTRAINT TRIGGER la05_checkout_commit_lease AFTER INSERT OR UPDATE
      ON la05_checkout_authorization DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION la05_checkout_commit_lease();`)
  }

  async down(): Promise<void> {
    // Removing the fence would reopen activated carts to unauthorized
    // completion and discard consumption history. Preserve by review.
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'Checkout commit fence rollback requires reviewed history preservation'; END $$;`,
    )
  }
}
