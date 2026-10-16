import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-039 Trade-0: Trade's own append-only record of every native
 * seller-configuration attestation CP accepted. It is evidence of what Trade
 * attested, never binding authority: CP alone holds binding state.
 *
 * The database recomputes the SHA-256 digest from the stored canonical
 * document, so a row can never claim a digest its configuration does not
 * produce, and rows can never be rewritten or deleted.
 */
export class Migration20261016090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`CREATE TABLE trade_native_configuration_attestation (
      attestation_id uuid PRIMARY KEY,
      native_configuration_reference text NOT NULL
        CHECK (native_configuration_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
          AND length(native_configuration_reference) <= 128),
      native_configuration_digest text NOT NULL CHECK (native_configuration_digest ~ '^[0-9a-f]{64}$'),
      canonical_configuration text NOT NULL,
      tenant_id text NOT NULL CHECK (tenant_id ~ '^tn_[a-z0-9]+$'),
      operating_organisation_id uuid NOT NULL,
      market text NOT NULL CHECK (market ~ '^[A-Z]{2}$'),
      engine_instance_id text NOT NULL CHECK (engine_instance_id ~ '^ei_[a-z0-9]+$'),
      currency_scope text[] NOT NULL CHECK (cardinality(currency_scope) > 0),
      context_id uuid NOT NULL,
      attested_at timestamptz NOT NULL,
      cp_recorded_at timestamptz NOT NULL,
      correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) > 0),
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (native_configuration_digest =
        encode(sha256(convert_to(canonical_configuration, 'UTF8')), 'hex')),
      CHECK (canonical_configuration::jsonb->>'native_configuration_reference' = native_configuration_reference),
      CHECK (canonical_configuration::jsonb->>'tenant_id' = tenant_id),
      CHECK (canonical_configuration::jsonb->>'operating_organisation_id' = operating_organisation_id::text),
      CHECK (canonical_configuration::jsonb->>'market' = market),
      CHECK (canonical_configuration::jsonb->>'engine_instance_id' = engine_instance_id),
      CHECK (attested_at <= cp_recorded_at + interval '5 seconds'));
    CREATE INDEX trade_native_configuration_attestation_reference
      ON trade_native_configuration_attestation (native_configuration_reference, recorded_at DESC);`)
    this
      .addSql(`CREATE FUNCTION trade_native_configuration_attestation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Trade-0: native-configuration attestation history is append-only';
    END $$;`)
    this.addSql(`CREATE TRIGGER trade_native_configuration_attestation_immutable
      BEFORE UPDATE OR DELETE ON trade_native_configuration_attestation
      FOR EACH ROW EXECUTE FUNCTION trade_native_configuration_attestation_guard();
    CREATE TRIGGER trade_native_configuration_attestation_no_truncate
      BEFORE TRUNCATE ON trade_native_configuration_attestation
      FOR EACH STATEMENT EXECUTE FUNCTION trade_native_configuration_attestation_guard();`)
  }

  async down(): Promise<void> {
    // Dropping the table would discard the evidence of what Trade attested.
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'Trade-0 attestation history rollback requires reviewed history preservation'; END $$;`,
    )
  }
}
