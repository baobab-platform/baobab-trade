import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260908030000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "thamani_supplier" (
      "id" text not null,
      "supplier_key" text not null,
      "name" text not null,
      "category" text check ("category" in ('FOOD_MANUFACTURER','COFFEE_ROASTER','FMCG_DISTRIBUTOR','PERSONAL_CARE_MANUFACTURER','HOUSEHOLD_GOODS_SUPPLIER','REGIONAL_WHOLESALER','IMPORTER','LOCAL_SME','AGRICULTURAL_SUPPLIER','EXTERNAL_B2B_SUPPLIER')) not null,
      "origin_country" text not null,
      "synthetic" boolean not null default true,
      "erp_business_partner_reference" text null,
      "status" text check ("status" in ('ACTIVE','SUSPENDED')) not null default 'ACTIVE',
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "thamani_supplier_pkey" primary key ("id")
    );`)

    this.addSql(`create table if not exists "thamani_product_retail_profile" (
      "id" text not null,
      "product_id" text not null,
      "canonical_product_key" text not null,
      "supplier_id" text not null,
      "country_of_origin" text not null,
      "hs_classification_reference" text not null,
      "customs_category" text not null,
      "product_tax_category" text check ("product_tax_category" in ('STANDARD','ZERO_RATED','EXEMPT')) not null,
      "brand" text not null,
      "net_weight_kg" real not null,
      "gross_weight_kg" real not null,
      "packaging" text not null,
      "trade_uom" text check ("trade_uom" in ('EACH')) not null,
      "consumer_uom" text not null,
      "food_attributes" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "thamani_product_retail_profile_pkey" primary key ("id"),
      constraint "thamani_product_retail_profile_supplier_fk" foreign key ("supplier_id") references "thamani_supplier" ("id") on delete restrict
    );`)

    this.addSql(`create table if not exists "thamani_market_product_eligibility" (
      "id" text not null,
      "product_id" text not null,
      "market_key" text not null,
      "status" text check ("status" in ('ACTIVE','SUSPENDED','WITHDRAWN')) not null default 'ACTIVE',
      "policy_reference" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "thamani_market_product_eligibility_pkey" primary key ("id")
    );`)

    for (const sql of [
      `create unique index if not exists "IDX_thamani_supplier_key" on "thamani_supplier" ("supplier_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_thamani_retail_profile_product" on "thamani_product_retail_profile" ("product_id") where "deleted_at" is null`,
      `create unique index if not exists "IDX_thamani_retail_profile_canonical" on "thamani_product_retail_profile" ("canonical_product_key") where "deleted_at" is null`,
      `create index if not exists "IDX_thamani_retail_profile_supplier" on "thamani_product_retail_profile" ("supplier_id") where "deleted_at" is null`,
      `create index if not exists "IDX_thamani_market_eligibility_product" on "thamani_market_product_eligibility" ("product_id") where "deleted_at" is null`,
      `create index if not exists "IDX_thamani_market_eligibility_market" on "thamani_market_product_eligibility" ("market_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_thamani_market_eligibility" on "thamani_market_product_eligibility" ("product_id", "market_key") where "deleted_at" is null`,
    ]) {
      this.addSql(`${sql};`)
    }
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "thamani_market_product_eligibility" cascade;')
    this.addSql('drop table if exists "thamani_product_retail_profile" cascade;')
    this.addSql('drop table if exists "thamani_supplier" cascade;')
  }
}
