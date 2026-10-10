import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/** Deny by default: no rows are inserted by this migration. */
export class Migration20261010013000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "native_seller_cart_binding" (
      "id" text not null primary key,
      "cart_id" text not null,
      "tenant_id" text not null,
      "organisation_id" text not null,
      "context_id" text not null,
      "responsible_legal_entity_id" text not null,
      "sales_channel_id" text not null,
      "region_id" text not null,
      "market_code" text not null,
      "market_key" text not null,
      "legal_activity" text not null,
      "legal_capability" text not null,
      "currency_code" text not null,
      "approval_reference" text not null,
      "approval_scope" text not null
        check ("approval_scope" = 'SELLER_OF_RECORD_CART_BINDING'),
      "proposed_by" text not null,
      "proposed_at" timestamptz not null,
      "approved_by" text not null,
      "approved_at" timestamptz not null,
      "expires_at" timestamptz not null,
      "status" text not null default 'ACTIVE'
        check ("status" in ('ACTIVE','REVOKED','EXPIRED')),
      "correlation_id" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "native_seller_binding_validity"
        check ("expires_at" > "approved_at" and "approved_at" >= "proposed_at"
          and "approved_by" <> "proposed_by"),
      constraint "native_seller_binding_market"
        check ("market_code" ~ '^[A-Z]{2}$'),
      constraint "native_seller_binding_currency"
        check ("currency_code" ~ '^[A-Z]{3}$')
    );`)
    this.addSql(`create unique index if not exists "IDX_native_seller_cart_active"
      on "native_seller_cart_binding" ("cart_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_native_seller_tenant"
      on "native_seller_cart_binding" ("tenant_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_native_seller_org"
      on "native_seller_cart_binding" ("organisation_id") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "native_seller_cart_binding" cascade;')
  }
}
