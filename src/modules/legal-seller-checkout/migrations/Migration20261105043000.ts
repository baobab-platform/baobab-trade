import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * CAA-06b final-cart price evidence. Source facts are NOT permissions.
 * A pricing/regulated-charge issuer must separately establish provider,
 * legal-actor, Market and policy provenance before inserting this row.
 * The cart reader fails closed while such an issuer has not been connected.
 */
export class Migration20261105043000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      "CREATE TABLE trade_native_cart_charge_determination (" +
        "tenant_id text NOT NULL, cart_id text NOT NULL, market_id text NOT NULL," +
        "seller_legal_entity_id text NOT NULL, resource_version bigint NOT NULL," +
        "charge_kind text NOT NULL CHECK (charge_kind IN (" +
          "'TAX','FREIGHT','DUTY','HANDLING','INSURANCE','SERVICE_CHARGE','REFUNDABLE_DEPOSIT'))," +
        "resolution text NOT NULL CHECK (resolution IN (" +
          "'CHARGED','ZERO_RATED','EXEMPT','NOT_APPLICABLE'))," +
        "amount_minor numeric(19,0) NOT NULL CHECK (amount_minor >= 0 " +
          "AND amount_minor <= 9007199254740991)," +
        "currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$')," +
        "source_reference text NOT NULL CHECK (length(source_reference) BETWEEN 8 AND 200)," +
        "evaluated_at timestamptz NOT NULL, expires_at timestamptz NOT NULL," +
        "recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()," +
        "PRIMARY KEY(tenant_id,cart_id,market_id,seller_legal_entity_id,resource_version,charge_kind)," +
        "CHECK (resource_version > 0)," +
        "CHECK (expires_at > evaluated_at AND expires_at <= evaluated_at + interval '5 minutes')," +
        "CHECK ((resolution='CHARGED' AND amount_minor > 0) " +
          "OR (resolution<>'CHARGED' AND amount_minor=0))" +
      ");",
    )
    this.addSql(
      "CREATE FUNCTION trade_native_cart_charge_immutable() RETURNS trigger " +
      "LANGUAGE plpgsql AS $$ BEGIN " +
      "RAISE EXCEPTION 'CAA-06b: final cart charge determination is immutable'; " +
      "END $$;",
    )
    this.addSql(
      "CREATE TRIGGER trade_native_cart_charge_no_update BEFORE UPDATE OR DELETE " +
      "ON trade_native_cart_charge_determination FOR EACH ROW " +
      "EXECUTE FUNCTION trade_native_cart_charge_immutable();",
    )
    this.addSql(
      "CREATE TRIGGER trade_native_cart_charge_no_truncate BEFORE TRUNCATE " +
      "ON trade_native_cart_charge_determination FOR EACH STATEMENT " +
      "EXECUTE FUNCTION trade_native_cart_charge_immutable();",
    )
  }

  async down(): Promise<void> {
    this.addSql("DROP TABLE IF EXISTS trade_native_cart_charge_determination CASCADE;")
    this.addSql("DROP FUNCTION IF EXISTS trade_native_cart_charge_immutable();")
  }
}
