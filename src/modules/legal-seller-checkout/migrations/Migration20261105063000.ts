import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/** DEV-07 CAA-06b: immutable companion to each final tax/freight/duty
 * determination. Old rows WITHOUT independent governed issuer provenance
 * remain readable as history but cannot qualify new buyer commitments.
 */
export class Migration20261105063000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      "CREATE TABLE trade_native_cart_charge_authority (" +
        "tenant_id text NOT NULL, cart_id text NOT NULL, market_id text NOT NULL," +
        "seller_legal_entity_id text NOT NULL, resource_version bigint NOT NULL," +
        "charge_kind text NOT NULL, issuer_id text NOT NULL," +
        "attestation_id uuid NOT NULL, cp_decision_id uuid NOT NULL," +
        "source_digest char(64) NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$')," +
        "policy_reference text NOT NULL CHECK (length(policy_reference) BETWEEN 8 AND 200)," +
        "verified_at timestamptz NOT NULL DEFAULT clock_timestamp()," +
        "PRIMARY KEY (tenant_id,cart_id,market_id,seller_legal_entity_id,resource_version,charge_kind)," +
        "FOREIGN KEY (tenant_id,cart_id,market_id,seller_legal_entity_id,resource_version,charge_kind)" +
        " REFERENCES trade_native_cart_charge_determination" +
        " (tenant_id,cart_id,market_id,seller_legal_entity_id,resource_version,charge_kind)" +
      ");",
    )
    this.addSql(
      "CREATE TRIGGER trade_native_cart_charge_authority_no_update BEFORE UPDATE OR DELETE " +
      "ON trade_native_cart_charge_authority FOR EACH ROW " +
      "EXECUTE FUNCTION trade_native_cart_charge_immutable();",
    )
    this.addSql(
      "CREATE TRIGGER trade_native_cart_charge_authority_no_truncate BEFORE TRUNCATE " +
      "ON trade_native_cart_charge_authority FOR EACH STATEMENT " +
      "EXECUTE FUNCTION trade_native_cart_charge_immutable();",
    )
  }

  async down(): Promise<void> {
    // Authority history is immutable: automatic downgrade is forbidden.
    this.addSql(
      "DO $$ BEGIN RAISE EXCEPTION 'CAA-06b governed charge-issuer evidence cannot be erased'; END $$;",
    )
  }
}
