import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-039 Trade-A TA-04: Trade-owned seller attribution of native carts,
 * draft orders and orders to ONE CP Seller Operating Binding.
 *
 * Each row records a CP discovery resolution for one native record: the
 * attested native configuration, its live digest, the resolved binding id and
 * version, and the CP context it was resolved under. An attribution is
 * PROVISIONAL evidence for a later order-authority decision, never authority.
 *
 * Append-only. The database refuses:
 * - a different seller binding for a record that already has one (Trade never
 *   silently substitutes a seller; a new binding VERSION of the same binding
 *   is a re-resolution and is allowed);
 * - an attribution whose native configuration does not match Trade's own
 *   recorded attestation of it;
 * - any UPDATE, DELETE or TRUNCATE.
 * Existing native_seller_cart_binding history is untouched and never promoted.
 */
export class Migration20261016120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`CREATE TABLE trade_commitment_attribution (
      attribution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_type text NOT NULL CHECK (subject_type IN ('cart', 'draft_order', 'order')),
      subject_id text NOT NULL CHECK (length(btrim(subject_id)) BETWEEN 1 AND 200),
      attestation_id uuid NOT NULL REFERENCES trade_native_configuration_attestation (attestation_id),
      native_configuration_reference text NOT NULL,
      native_configuration_digest text NOT NULL CHECK (native_configuration_digest ~ '^[0-9a-f]{64}$'),
      currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      tenant_id text NOT NULL CHECK (tenant_id ~ '^tn_[a-z0-9]+$'),
      operating_organisation_id uuid NOT NULL,
      market text NOT NULL CHECK (market ~ '^[A-Z]{2}$'),
      engine_instance_id text NOT NULL CHECK (engine_instance_id ~ '^ei_[a-z0-9]+$'),
      binding_id uuid NOT NULL,
      binding_version integer NOT NULL CHECK (binding_version >= 1),
      resolution_id uuid NOT NULL UNIQUE,
      context_id uuid NOT NULL,
      resolved_at timestamptz NOT NULL,
      correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) > 0),
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (resolved_at <= recorded_at + interval '5 seconds'));
    CREATE INDEX trade_commitment_attribution_subject
      ON trade_commitment_attribution (subject_type, subject_id, recorded_at DESC);`)
    this
      .addSql(`CREATE FUNCTION trade_commitment_attribution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE prior_binding uuid; prior_version integer;
    BEGIN
      IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Trade-A: commitment attribution history is append-only';
      END IF;
      -- Serialise attributions of one native record.
      PERFORM pg_advisory_xact_lock(hashtextextended('trade-attribution/' || NEW.subject_type || '/' || NEW.subject_id, 0));
      -- The configuration must be exactly what Trade itself attested.
      PERFORM 1 FROM trade_native_configuration_attestation a
        WHERE a.attestation_id = NEW.attestation_id
          AND a.native_configuration_reference = NEW.native_configuration_reference
          AND a.native_configuration_digest = NEW.native_configuration_digest
          AND a.tenant_id = NEW.tenant_id AND a.operating_organisation_id = NEW.operating_organisation_id
          AND a.market = NEW.market AND a.engine_instance_id = NEW.engine_instance_id
          AND NEW.currency = ANY (a.currency_scope);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade-A denied: attribution does not match Trade''s attested native configuration';
      END IF;
      SELECT binding_id, binding_version INTO prior_binding, prior_version
        FROM trade_commitment_attribution
        WHERE subject_type = NEW.subject_type AND subject_id = NEW.subject_id
        ORDER BY recorded_at DESC, attribution_id DESC LIMIT 1;
      IF FOUND AND prior_binding <> NEW.binding_id THEN
        RAISE EXCEPTION 'Trade-A denied: the seller binding of this record changed; re-evaluation required';
      END IF;
      IF FOUND AND NEW.binding_version < prior_version THEN
        RAISE EXCEPTION 'Trade-A denied: an attribution may not regress to an older binding version';
      END IF;
      RETURN NEW;
    END $$;`)
    this.addSql(`CREATE TRIGGER trade_commitment_attribution_guard
      BEFORE INSERT OR UPDATE OR DELETE ON trade_commitment_attribution
      FOR EACH ROW EXECUTE FUNCTION trade_commitment_attribution_guard();
    CREATE TRIGGER trade_commitment_attribution_no_truncate
      BEFORE TRUNCATE ON trade_commitment_attribution
      FOR EACH STATEMENT EXECUTE FUNCTION trade_commitment_attribution_guard();`)
  }

  async down(): Promise<void> {
    // Dropping the table would discard the evidence of which seller a record was attributed to.
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'Trade-A attribution rollback requires reviewed history preservation'; END $$;`,
    )
  }
}
