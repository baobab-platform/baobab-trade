import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-042 section 14 Decision 9 (Shared control-plane/v1
 * estate-resource-assignment; ADR-0035): a commerce profile answer may now
 * rest on either CP-verified estate provenance, the estate client binding of
 * a governed BFF request or the governed resource assignment attestation of a
 * non-BFF commitment. Each observation records which one, by its CP
 * reference. Existing rows were all estate client bindings.
 *
 * Nothing else changes: the observation stays append-only, and a
 * classification still needs a live ATTESTED observation and the resource's
 * current seller attribution.
 */
export class Migration20261023090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE trade_commerce_profile_observation
      RENAME COLUMN estate_binding_id TO estate_provenance_reference;
    ALTER TABLE trade_commerce_profile_observation
      ADD COLUMN estate_provenance_kind text NOT NULL DEFAULT 'ESTATE_CLIENT_BINDING'
        CHECK (estate_provenance_kind IN ('ESTATE_CLIENT_BINDING', 'GOVERNED_RESOURCE_ASSIGNMENT'));
    ALTER TABLE trade_commerce_profile_observation ALTER COLUMN estate_provenance_kind DROP DEFAULT;`)
  }

  async down(): Promise<void> {
    // Folding an assignment observation into a binding column would misstate its provenance.
    this.addSql(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM trade_commerce_profile_observation
                  WHERE estate_provenance_kind <> 'ESTATE_CLIENT_BINDING') THEN
        RAISE EXCEPTION 'Decision 9 rollback would misstate governed resource assignment provenance';
      END IF;
    END $$;
    ALTER TABLE trade_commerce_profile_observation DROP COLUMN estate_provenance_kind;
    ALTER TABLE trade_commerce_profile_observation
      RENAME COLUMN estate_provenance_reference TO estate_binding_id;`)
  }
}
