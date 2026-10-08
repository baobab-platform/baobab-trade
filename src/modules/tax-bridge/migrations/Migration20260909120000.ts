import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260909120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "tax_rule_projection" add column if not exists "digital_estate" text null;',
    )
    // ZuriBeans' own Gate 10 bootstrap deliberately creates no statutory rules (see its
    // "without statutory rates" log line), but its verify:tax script does create one synthetic
    // fixture rule ("gate10:synthetic:ug:goods") in this table on any environment where it has
    // already run — every real Thamani rule reference carries a "thamani:" prefix
    // (THAMANI_STANDARD_TAX_RULES), so that prefix, not "everything else is Thamani", is the
    // correct signal.
    this.addSql(
      `update "tax_rule_projection" set "digital_estate" = case
        when "rule_reference" like 'thamani:%' then 'estate:thamani-b2c'
        else 'estate:zuribeans-b2b'
      end where "digital_estate" is null;`,
    )
    this.addSql('alter table "tax_rule_projection" alter column "digital_estate" set not null;')
    this.addSql(
      `alter table "tax_rule_projection" add constraint "tax_rule_digital_estate_check" check ("digital_estate" in ('estate:zuribeans-b2b','estate:thamani-b2c'));`,
    )
    this.addSql('drop index if exists "IDX_tax_rule_version";')
    this.addSql(
      `create unique index if not exists "IDX_tax_rule_version" on "tax_rule_projection" ("digital_estate", "rule_reference", "rule_version") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "IDX_tax_rule_version";')
    this.addSql(
      `create unique index if not exists "IDX_tax_rule_version" on "tax_rule_projection" ("rule_reference", "rule_version") where "deleted_at" is null;`,
    )
    this.addSql(
      'alter table "tax_rule_projection" drop constraint if exists "tax_rule_digital_estate_check";',
    )
    this.addSql('alter table "tax_rule_projection" drop column if exists "digital_estate";')
  }
}
