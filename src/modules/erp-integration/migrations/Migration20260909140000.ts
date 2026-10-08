import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260909140000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "erp_entity_mapping" add column if not exists "digital_estate" text null;',
    )
    // canonical_entity_id's "th-"/"TH-" prefix convention only covers Thamani's PRODUCT and
    // WAREHOUSE mappings — its SUPPLIER mappings use supplier keys like
    // "sup_ug_mountain_roasters" with no such prefix. external_reference is the one field every
    // Thamani mapping (product, supplier, and warehouse alike) carries a ":thamani:" marker in —
    // see bootstrap-thamani-erp-integration.ts's external_reference construction for all three.
    this.addSql(
      `update "erp_entity_mapping" set "digital_estate" = case
        when "external_reference" like '%:thamani:%' then 'estate:thamani-b2c'
        else 'estate:zuribeans-b2b'
      end where "digital_estate" is null;`,
    )
    this.addSql('alter table "erp_entity_mapping" alter column "digital_estate" set not null;')
    this.addSql(
      `alter table "erp_entity_mapping" add constraint "erp_mapping_digital_estate_check" check ("digital_estate" in ('estate:zuribeans-b2b','estate:thamani-b2c'));`,
    )
    this.addSql('drop index if exists "IDX_erp_mapping_canonical";')
    this.addSql(
      `create unique index if not exists "IDX_erp_mapping_canonical" on "erp_entity_mapping" ("mapping_type", "digital_estate", "canonical_entity_id") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "IDX_erp_mapping_canonical";')
    this.addSql(
      `create unique index if not exists "IDX_erp_mapping_canonical" on "erp_entity_mapping" ("mapping_type", "canonical_entity_id") where "deleted_at" is null;`,
    )
    this.addSql(
      'alter table "erp_entity_mapping" drop constraint if exists "erp_mapping_digital_estate_check";',
    )
    this.addSql('alter table "erp_entity_mapping" drop column if exists "digital_estate";')
  }
}
