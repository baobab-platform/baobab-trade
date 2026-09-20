import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260920200000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "erp_buyer_commercial_profile_projection" (
        "id" text not null,
        "buyer_organisation_id" text not null,
        "tenant_id" text not null,
        "legal_entity_id" text not null,
        "business_partner_id" text not null,
        "credit_status" text check ("credit_status" in ('APPROVED','ON_HOLD','REJECTED')) not null,
        "payment_term_code" text null,
        "credit_limit_minor" numeric null,
        "currency_code" text not null,
        "profile_reference" text not null,
        "source_event_id" text not null,
        "source_correlation_id" text not null,
        "observed_at" timestamptz not null,
        "applied_at" timestamptz not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "erp_buyer_commercial_profile_projection_pkey" primary key ("id")
      );
    `)
    this.addSql('create unique index if not exists "IDX_erpbcp_source_event" on "erp_buyer_commercial_profile_projection" ("source_event_id") where "deleted_at" is null;')
    this.addSql('create unique index if not exists "IDX_erpbcp_identity" on "erp_buyer_commercial_profile_projection" ("buyer_organisation_id", "profile_reference", "source_event_id") where "deleted_at" is null;')
    this.addSql('create index if not exists "IDX_erpbcp_buyer" on "erp_buyer_commercial_profile_projection" ("buyer_organisation_id") where "deleted_at" is null;')
    this.addSql('create index if not exists "IDX_erpbcp_tenant" on "erp_buyer_commercial_profile_projection" ("tenant_id") where "deleted_at" is null;')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "erp_buyer_commercial_profile_projection" cascade;')
  }
}
