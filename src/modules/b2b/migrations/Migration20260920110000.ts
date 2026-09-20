import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260920110000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "b2b_buyer_application" (
      "id" text not null,
      "tenant_id" text not null,
      "applicant_customer_id" text not null,
      "applicant_principal_id" text null,
      "legal_name" text not null,
      "trading_name" text null,
      "registration_number" text null,
      "country_of_registration" text null,
      "website" text null,
      "requested_market_keys" jsonb not null default '[]'::jsonb,
      "status" text check ("status" in ('DRAFT','SUBMITTED','INFORMATION_REQUIRED','UNDER_REVIEW','APPROVED','REJECTED','WITHDRAWN')) not null default 'DRAFT',
      "revision" integer not null default 1,
      "submitted_at" timestamptz null,
      "assigned_reviewer_principal_id" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_buyer_application_pkey" primary key ("id"),
      constraint "b2b_buyer_application_revision_positive" check ("revision" > 0)
    );`)

    this.addSql(`create table if not exists "b2b_buyer_application_decision" (
      "id" text not null,
      "application_id" text not null,
      "decision" text check ("decision" in ('APPROVED','REJECTED')) not null,
      "decided_by_principal_id" text not null,
      "decision_reference" text not null,
      "reason_code" text null,
      "canonical_organisation_id" text null,
      "decided_at" timestamptz not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_buyer_application_decision_pkey" primary key ("id"),
      constraint "b2b_buyer_application_decision_application_fk" foreign key ("application_id") references "b2b_buyer_application" ("id") on delete restrict
    );`)

    this.addSql(`create index if not exists "IDX_b2b_buyer_application_tenant_customer" on "b2b_buyer_application" ("tenant_id", "applicant_customer_id") where "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_b2b_buyer_application_open" on "b2b_buyer_application" ("tenant_id", "applicant_customer_id") where "deleted_at" is null and "status" in ('DRAFT','SUBMITTED','INFORMATION_REQUIRED','UNDER_REVIEW');`)
    this.addSql(`create unique index if not exists "IDX_b2b_buyer_application_decision_application" on "b2b_buyer_application_decision" ("application_id") where "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_b2b_buyer_application_decision_reference" on "b2b_buyer_application_decision" ("decision_reference") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "b2b_buyer_application_decision" cascade;')
    this.addSql('drop table if exists "b2b_buyer_application" cascade;')
  }
}
