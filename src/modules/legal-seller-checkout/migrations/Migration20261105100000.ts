import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/** Keep the exact native cart version across the price, spend and buyer
 * receipt records. The governed Cart Module reader uses epoch milliseconds,
 * which already exceed a PostgreSQL integer. Historical small versions stay
 * valid. Only the width of the existing guard comparison changes. */
export class Migration20261105100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE b2b_spend_reservation
      ALTER COLUMN resource_version TYPE bigint,
      ADD CONSTRAINT b2b_spend_reservation_version_safe_integer
        CHECK (resource_version <= 9007199254740991);`)
    this.addSql(`DO $migration$
      DECLARE
        guard text := pg_get_functiondef('trade_buyer_authority_consumption_guard()'::regprocedure);
        old_comparison text := $comparison$(buyer.payload->>'resource_version')::integer IS DISTINCT FROM reserve.resource_version$comparison$;
        new_comparison text := $comparison$(buyer.payload->>'resource_version')::bigint IS DISTINCT FROM reserve.resource_version$comparison$;
      BEGIN
        IF strpos(guard, old_comparison) = 0 OR
           strpos(substr(guard, strpos(guard, old_comparison) + length(old_comparison)), old_comparison) > 0 THEN
          RAISE EXCEPTION 'CAA-06b: expected exactly one original spend version comparison';
        END IF;
        EXECUTE replace(guard, old_comparison, new_comparison);
      END
    $migration$;`)
  }

  async down(): Promise<void> {
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'CAA-06b: narrowing the version requires reviewed spend history preservation'; END $$;`,
    )
  }
}
