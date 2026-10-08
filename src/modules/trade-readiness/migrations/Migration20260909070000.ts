import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260909070000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "thamani_trade_profile" (
      "id" text not null, "canonical_product_key" text not null, "market_key" text not null,
      "origin_country" text not null, "hs_classification_reference" text not null,
      "hs_classification_status" text check ("hs_classification_status" in ('VERIFIED','UNVERIFIED')) not null,
      "customs_tariff_reference" text not null, "landed_cost_reference" text not null,
      "source" text not null, "reviewed_at" timestamptz null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null, constraint "thamani_trade_profile_pkey" primary key ("id"),
      constraint "thamani_trade_profile_hs" check ("hs_classification_reference" ~ '^HS-[0-9]{4}(\\.[0-9]{2,6})?$'),
      constraint "thamani_trade_profile_review" check ("hs_classification_status" <> 'VERIFIED' or "reviewed_at" is not null)
    );`)
    this.addSql(
      `create unique index if not exists "IDX_thamani_trade_profile_scope" on "thamani_trade_profile" ("canonical_product_key", "market_key") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "thamani_trade_profile" cascade;')
  }
}
