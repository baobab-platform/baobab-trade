import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261127093000 extends Migration {
  async up(): Promise<void> {
    // Legacy fulfilments remain nullable until their original authority context
    // is independently reconciled. New Trade requests populate the complete set.
    this.addSql('alter table "commerce_fulfilment" add column if not exists "tenant_id" text null;')
    this.addSql('alter table "commerce_fulfilment" add column if not exists "principal_id" text null;')
    this.addSql('alter table "commerce_fulfilment" add column if not exists "market_id" text null;')
    this.addSql('alter table "commerce_fulfilment" add column if not exists "market_revision" bigint null;')
    this.addSql('alter table "commerce_fulfilment" add column if not exists "raw_market_revision" jsonb null;')
    this.addSql('alter table "commerce_fulfilment" add constraint "commerce_fulfilment_market_revision_check" check ("market_revision" is null or "market_revision" > 0);')
    this.addSql('alter table "commerce_fulfilment" add constraint "commerce_fulfilment_authority_context_check" check (("tenant_id" is null and "principal_id" is null and "market_id" is null and "market_revision" is null) or ("tenant_id" is not null and "principal_id" is not null and "market_id" is not null and "market_revision" is not null));')
    this.addSql('create index if not exists "IDX_commerce_fulfilment_tenant" on "commerce_fulfilment" ("tenant_id") where "deleted_at" is null;')
    this.addSql('create index if not exists "IDX_commerce_fulfilment_principal" on "commerce_fulfilment" ("principal_id") where "deleted_at" is null;')
    this.addSql('create index if not exists "IDX_commerce_fulfilment_market_id" on "commerce_fulfilment" ("market_id") where "deleted_at" is null;')
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "IDX_commerce_fulfilment_market_id";')
    this.addSql('drop index if exists "IDX_commerce_fulfilment_principal";')
    this.addSql('drop index if exists "IDX_commerce_fulfilment_tenant";')
    this.addSql('alter table "commerce_fulfilment" drop constraint if exists "commerce_fulfilment_authority_context_check";')
    this.addSql('alter table "commerce_fulfilment" drop constraint if exists "commerce_fulfilment_market_revision_check";')
    this.addSql('alter table "commerce_fulfilment" drop column if exists "raw_market_revision";')
    this.addSql('alter table "commerce_fulfilment" drop column if exists "market_revision";')
    this.addSql('alter table "commerce_fulfilment" drop column if exists "market_id";')
    this.addSql('alter table "commerce_fulfilment" drop column if exists "principal_id";')
    this.addSql('alter table "commerce_fulfilment" drop column if exists "tenant_id";')
  }
}
