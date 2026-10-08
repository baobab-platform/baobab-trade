import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260907190000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "b2b_product_trade_profile" (
      "id" text not null,
      "product_id" text not null,
      "canonical_product_key" text not null,
      "country_of_origin" text not null,
      "hs_classification_reference" text not null,
      "commodity_category" text not null,
      "trade_uom" text check ("trade_uom" in ('BAG','CARTON')) not null,
      "net_weight_kg" real not null,
      "gross_weight_kg" real not null,
      "packaging" text not null,
      "lot_controlled" boolean not null default true,
      "batch_controlled" boolean not null default true,
      "export_eligibility_reference" text not null,
      "commodity_attributes" jsonb not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_product_trade_profile_pkey" primary key ("id")
    );`)

    this.addSql(`create table if not exists "b2b_market_product_eligibility" (
      "id" text not null,
      "product_id" text not null,
      "market_key" text not null,
      "status" text check ("status" in ('ACTIVE','SUSPENDED','WITHDRAWN')) not null default 'ACTIVE',
      "policy_reference" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_market_product_eligibility_pkey" primary key ("id")
    );`)

    this.addSql(`create table if not exists "b2b_purchase_constraint" (
      "id" text not null,
      "variant_id" text not null,
      "market_key" text not null,
      "minimum_order_quantity" integer not null,
      "order_multiple" integer not null,
      "trade_uom" text check ("trade_uom" in ('BAG','CARTON')) not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_purchase_constraint_pkey" primary key ("id"),
      constraint "b2b_purchase_constraint_positive_check" check ("minimum_order_quantity" > 0 and "order_multiple" > 0)
    );`)

    this.addSql(`create table if not exists "b2b_contract_price" (
      "id" text not null,
      "organisation_id" text not null,
      "variant_id" text not null,
      "market_key" text not null,
      "currency_code" text not null,
      "amount" numeric not null,
      "raw_amount" jsonb not null,
      "minimum_quantity" integer null,
      "agreement_reference" text not null,
      "status" text check ("status" in ('DRAFT','ACTIVE','SUSPENDED','EXPIRED')) not null default 'DRAFT',
      "effective_from" timestamptz null,
      "effective_until" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_contract_price_pkey" primary key ("id"),
      constraint "b2b_contract_price_organisation_fk" foreign key ("organisation_id") references "b2b_organisation" ("id") on delete cascade,
      constraint "b2b_contract_price_positive_check" check ("amount" >= 0 and ("minimum_quantity" is null or "minimum_quantity" > 0))
    );`)

    for (const sql of [
      `create unique index if not exists "IDX_b2b_trade_profile_product" on "b2b_product_trade_profile" ("product_id") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_trade_profile_canonical" on "b2b_product_trade_profile" ("canonical_product_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_market_eligibility" on "b2b_market_product_eligibility" ("product_id", "market_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_purchase_constraint" on "b2b_purchase_constraint" ("variant_id", "market_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_contract_price" on "b2b_contract_price" ("organisation_id", "variant_id", "market_key", "currency_code", "agreement_reference") where "deleted_at" is null`,
    ]) {
      this.addSql(`${sql};`)
    }
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "b2b_contract_price" cascade;')
    this.addSql('drop table if exists "b2b_purchase_constraint" cascade;')
    this.addSql('drop table if exists "b2b_market_product_eligibility" cascade;')
    this.addSql('drop table if exists "b2b_product_trade_profile" cascade;')
  }
}
