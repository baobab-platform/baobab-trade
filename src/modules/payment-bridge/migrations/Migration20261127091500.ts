import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261127091500 extends Migration {
  async up(): Promise<void> {
    // Existing rows remain nullable until authoritative scope is reconciled.
    // New Trade writes require all fields and fail closed on legacy rows.
    this.addSql('alter table "commerce_payment" add column if not exists "tenant_id" text null;')
    this.addSql('alter table "commerce_payment" add column if not exists "principal_id" text null;')
    this.addSql('alter table "commerce_payment" add column if not exists "merchant_account_id" text null;')
    this.addSql('alter table "commerce_payment" add column if not exists "market_id" text null;')
    this.addSql('alter table "commerce_payment" add column if not exists "market_revision" bigint null;')
    this.addSql('alter table "commerce_payment" add column if not exists "raw_market_revision" jsonb null;')
    this.addSql('alter table "commerce_payment" add column if not exists "provider_environment" text null;')
    this.addSql('alter table "commerce_payment" add constraint "commerce_payment_market_revision_check" check ("market_revision" is null or "market_revision" > 0);')
    this.addSql('alter table "commerce_payment" add constraint "commerce_payment_provider_environment_check" check ("provider_environment" is null or "provider_environment" in (\'SANDBOX\',\'LIVE\'));')
    this.addSql('alter table "commerce_payment" add constraint "commerce_payment_context_scope_check" check (("tenant_id" is null and "principal_id" is null and "merchant_account_id" is null and "provider_environment" is null and "market_id" is null and "market_revision" is null) or ("tenant_id" is not null and "principal_id" is not null and "merchant_account_id" is not null and "provider_environment" is not null and "market_id" is not null and "market_revision" is not null));')
    this.addSql('create index if not exists "IDX_commerce_payment_tenant" on "commerce_payment" ("tenant_id") where "deleted_at" is null;')
    this.addSql('create index if not exists "IDX_commerce_payment_principal" on "commerce_payment" ("principal_id") where "deleted_at" is null;')
    this.addSql('create unique index if not exists "IDX_commerce_payment_provider_merchant_environment_reference" on "commerce_payment" ("provider_key", "merchant_account_id", "provider_environment", "provider_reference") where "provider_reference" is not null and "merchant_account_id" is not null and "provider_environment" is not null and "deleted_at" is null;')
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "IDX_commerce_payment_provider_merchant_environment_reference";')
    this.addSql('drop index if exists "IDX_commerce_payment_principal";')
    this.addSql('drop index if exists "IDX_commerce_payment_tenant";')
    this.addSql('alter table "commerce_payment" drop constraint if exists "commerce_payment_context_scope_check";')
    this.addSql('alter table "commerce_payment" drop constraint if exists "commerce_payment_provider_environment_check";')
    this.addSql('alter table "commerce_payment" drop constraint if exists "commerce_payment_market_revision_check";')
    this.addSql('alter table "commerce_payment" drop column if exists "provider_environment";')
    this.addSql('alter table "commerce_payment" drop column if exists "raw_market_revision";')
    this.addSql('alter table "commerce_payment" drop column if exists "market_revision";')
    this.addSql('alter table "commerce_payment" drop column if exists "market_id";')
    this.addSql('alter table "commerce_payment" drop column if exists "merchant_account_id";')
    this.addSql('alter table "commerce_payment" drop column if exists "principal_id";')
    this.addSql('alter table "commerce_payment" drop column if exists "tenant_id";')
  }
}
