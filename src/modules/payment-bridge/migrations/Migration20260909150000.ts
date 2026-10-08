import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260909150000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "commerce_payment" add column if not exists "digital_estate" text null;',
    )
    // organisation_id and customer_reference are already mutually exclusive (one-party check
    // constraint), so which one is set is an exact, non-heuristic signal for which Digital
    // Estate an existing payment belongs to.
    this.addSql(
      `update "commerce_payment" set "digital_estate" = case
        when "organisation_id" is not null then 'estate:zuribeans-b2b'
        else 'estate:thamani-b2c'
      end where "digital_estate" is null;`,
    )
    this.addSql('alter table "commerce_payment" alter column "digital_estate" set not null;')
    this.addSql(
      `alter table "commerce_payment" add constraint "commerce_payment_digital_estate_check" check ("digital_estate" in ('estate:zuribeans-b2b','estate:thamani-b2c'));`,
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "commerce_payment" drop constraint if exists "commerce_payment_digital_estate_check";',
    )
    this.addSql('alter table "commerce_payment" drop column if exists "digital_estate";')
  }
}
