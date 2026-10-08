import { Migration } from "@medusajs/framework/mikro-orm/migrations"
export class Migration20260908090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `create table if not exists "tax_policy_binding" ("id" text not null, "market_key" text not null, "jurisdiction_key" text not null, "currency_code" text not null, "legal_seller_key" text not null, "provider_key" text not null, "seller_registration_reference" text not null, "prices_include_tax" boolean not null, "fail_closed" boolean not null, "status" text check ("status" in ('ACTIVE','SUSPENDED')) not null default 'ACTIVE', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tax_policy_binding_pkey" primary key ("id"));`,
    )
    this.addSql(
      `create table if not exists "tax_rule_projection" ("id" text not null, "rule_reference" text not null, "rule_version" text not null, "jurisdiction_key" text not null, "product_tax_classification" text not null, "transaction_type" text check ("transaction_type" in ('GOODS','SHIPPING','DISCOUNT','RETURN','REFUND')) not null, "treatment" text check ("treatment" in ('STANDARD','ZERO_RATED','EXEMPT','REVERSE_CHARGE')) not null, "rate_basis_points" integer not null, "legal_reason" text null, "effective_from" timestamptz not null, "effective_until" timestamptz null, "source_authority" text not null, "source_retrieved_at" timestamptz not null, "status" text check ("status" in ('ACTIVE','SUPERSEDED','REVOKED')) not null default 'ACTIVE', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tax_rule_projection_pkey" primary key ("id"), constraint "tax_rule_rate_check" check ("rate_basis_points" >= 0 and "rate_basis_points" <= 10000), constraint "tax_rule_period_check" check ("effective_until" is null or "effective_until" > "effective_from"));`,
    )
    this.addSql(
      `create table if not exists "b2b_tax_profile" ("id" text not null, "organisation_id" text not null, "jurisdiction_key" text not null, "registration_reference" text null, "verification_status" text check ("verification_status" in ('VERIFIED','UNVERIFIED','EXPIRED','REJECTED')) not null, "verified_at" timestamptz null, "verification_expires_at" timestamptz null, "verification_source" text null, "eligible_treatments" jsonb not null, "exemption_reason" text null, "provenance" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "b2b_tax_profile_pkey" primary key ("id"));`,
    )
    this.addSql(
      `create table if not exists "tax_determination" ("id" text not null, "determination_reference" text not null, "organisation_id" text not null, "market_key" text not null, "legal_seller_key" text not null, "jurisdiction_key" text not null, "product_tax_classification" text not null, "transaction_type" text not null, "treatment" text not null, "currency_code" text not null, "taxable_basis_minor" bigint not null, "raw_taxable_basis_minor" jsonb not null, "tax_amount_minor" bigint not null, "raw_tax_amount_minor" jsonb not null, "rate_basis_points" integer not null, "rule_reference" text not null, "rule_version" text not null, "provider_key" text not null, "calculation_reference" text not null, "source_authority" text not null, "source_retrieved_at" timestamptz not null, "legal_reason" text null, "effective_at" timestamptz not null, "source_idempotency_key" text not null, "correlation_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tax_determination_pkey" primary key ("id"), constraint "tax_amount_check" check ("taxable_basis_minor" >= 0 and "tax_amount_minor" >= 0));`,
    )
    this.addSql(
      `create table if not exists "tax_reconciliation" ("id" text not null, "determination_id" text not null, "erp_tax_reference" text null, "commerce_tax_minor" bigint not null, "raw_commerce_tax_minor" jsonb not null, "erp_tax_minor" bigint null, "raw_erp_tax_minor" jsonb null, "commerce_currency" text not null, "erp_currency" text null, "delta_minor" bigint not null, "raw_delta_minor" jsonb not null, "status" text check ("status" in ('MATCHED','VARIANCE','PENDING_ERP','RESOLVED')) not null, "reasons" jsonb not null, "source_idempotency_key" text not null, "observed_at" timestamptz not null, "resolved_at" timestamptz null, "resolution_note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tax_reconciliation_pkey" primary key ("id"), constraint "tax_reconciliation_fk" foreign key ("determination_id") references "tax_determination" ("id") on delete cascade);`,
    )
    for (const sql of [
      `create unique index if not exists "IDX_tax_policy_seller_market" on "tax_policy_binding" ("market_key", "legal_seller_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_tax_rule_version" on "tax_rule_projection" ("rule_reference", "rule_version") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_tax_profile_scope" on "b2b_tax_profile" ("organisation_id", "jurisdiction_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_tax_determination_reference" on "tax_determination" ("determination_reference") where "deleted_at" is null`,
      `create unique index if not exists "IDX_tax_determination_idempotency" on "tax_determination" ("source_idempotency_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_tax_reconciliation_idempotency" on "tax_reconciliation" ("source_idempotency_key") where "deleted_at" is null`,
    ])
      this.addSql(`${sql};`)
  }
  async down(): Promise<void> {
    this.addSql('drop table if exists "tax_reconciliation" cascade;')
    this.addSql('drop table if exists "tax_determination" cascade;')
    this.addSql('drop table if exists "b2b_tax_profile" cascade;')
    this.addSql('drop table if exists "tax_rule_projection" cascade;')
    this.addSql('drop table if exists "tax_policy_binding" cascade;')
  }
}
