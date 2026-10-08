import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260909050000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "tax_determination" alter column "organisation_id" drop not null;')
    this.addSql(
      'alter table "tax_determination" add column if not exists "customer_reference" text null;',
    )
    this.addSql(
      `alter table "tax_determination" add column if not exists "price_display_mode" text not null default 'TAX_EXCLUSIVE';`,
    )
    this.addSql(
      'alter table "tax_determination" add column if not exists "net_amount_minor" bigint not null default 0;',
    )
    this.addSql(
      'alter table "tax_determination" add column if not exists "gross_amount_minor" bigint not null default 0;',
    )
    this.addSql(
      'alter table "tax_determination" add column if not exists "raw_net_amount_minor" jsonb null;',
    )
    this.addSql(
      'alter table "tax_determination" add column if not exists "raw_gross_amount_minor" jsonb null;',
    )
    this.addSql(`update "tax_determination" set
      "net_amount_minor" = "taxable_basis_minor",
      "gross_amount_minor" = "taxable_basis_minor" + "tax_amount_minor",
      "raw_net_amount_minor" = "raw_taxable_basis_minor",
      "raw_gross_amount_minor" = to_jsonb(("taxable_basis_minor" + "tax_amount_minor")::text);`)
    this.addSql('alter table "tax_determination" alter column "raw_net_amount_minor" set not null;')
    this.addSql(
      'alter table "tax_determination" alter column "raw_gross_amount_minor" set not null;',
    )
    this.addSql('alter table "tax_determination" alter column "net_amount_minor" drop default;')
    this.addSql('alter table "tax_determination" alter column "gross_amount_minor" drop default;')
    this
      .addSql(`alter table "tax_determination" add constraint "tax_determination_one_subject" check (
      ("organisation_id" is not null and "customer_reference" is null) or
      ("organisation_id" is null and "customer_reference" is not null)
    );`)
    this.addSql(
      `alter table "tax_determination" add constraint "tax_determination_display_mode" check ("price_display_mode" in ('TAX_INCLUSIVE','TAX_EXCLUSIVE'));`,
    )
    this.addSql(
      `create index if not exists "IDX_tax_determination_customer" on "tax_determination" ("customer_reference") where "deleted_at" is null;`,
    )
    this.addSql(`create table if not exists "tax_category_projection" (
      "id" text not null, "market_key" text not null, "category_key" text not null,
      "treatment" text check ("treatment" in ('STANDARD','ZERO_RATED','EXEMPT')) not null,
      "rule_reference" text null,
      "verification_status" text check ("verification_status" in ('VERIFIED','REVIEW_REQUIRED')) not null,
      "source_authority" text null, "source_retrieved_at" timestamptz not null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null, constraint "tax_category_projection_pkey" primary key ("id"),
      constraint "tax_category_verified_rule" check ("verification_status" <> 'VERIFIED' or ("rule_reference" is not null and "source_authority" is not null))
    );`)
    this.addSql(
      `create unique index if not exists "IDX_tax_category_market" on "tax_category_projection" ("market_key", "category_key") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "tax_category_projection" cascade;')
    this.addSql('drop index if exists "IDX_tax_determination_customer";')
    this.addSql(
      'alter table "tax_determination" drop constraint if exists "tax_determination_display_mode";',
    )
    this.addSql(
      'alter table "tax_determination" drop constraint if exists "tax_determination_one_subject";',
    )
    this
      .addSql(`update "tax_determination" set "organisation_id" = 'legacy-b2c:' || "customer_reference"
      where "organisation_id" is null;`)
    this.addSql('alter table "tax_determination" drop column if exists "gross_amount_minor";')
    this.addSql('alter table "tax_determination" drop column if exists "raw_gross_amount_minor";')
    this.addSql('alter table "tax_determination" drop column if exists "net_amount_minor";')
    this.addSql('alter table "tax_determination" drop column if exists "raw_net_amount_minor";')
    this.addSql('alter table "tax_determination" drop column if exists "price_display_mode";')
    this.addSql('alter table "tax_determination" drop column if exists "customer_reference";')
    this.addSql('alter table "tax_determination" alter column "organisation_id" set not null;')
  }
}
