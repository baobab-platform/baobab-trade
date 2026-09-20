import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260920220000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "b2b_buyer_application_evidence" (
      "id" text not null, "application_id" text not null, "tenant_id" text not null,
      "evidence_type" text check ("evidence_type" in ('COMPANY_REGISTRATION','TAX_REGISTRATION','AUTHORIZED_REPRESENTATIVE','REGISTERED_ADDRESS','OWNERSHIP_STRUCTURE','BANK_ACCOUNT','OTHER')) not null,
      "canonical_document_id" text not null, "document_version" text not null,
      "content_sha256" text not null, "media_type" text not null, "size_bytes" numeric not null,
      "issued_at" timestamptz null, "expires_at" timestamptz null,
      "status" text check ("status" in ('PENDING','VERIFIED','REJECTED','SUPERSEDED')) not null default 'PENDING',
      "submitted_by_customer_id" text not null, "submitted_by_principal_id" text null,
      "idempotency_key" text not null, "request_hash" text not null, "submitted_at" timestamptz not null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null,
      constraint "b2b_buyer_application_evidence_pkey" primary key ("id"),
      constraint "b2b_buyer_application_evidence_size_check" check ("size_bytes" > 0 and "size_bytes" <= 26214400),
      constraint "b2b_buyer_application_evidence_sha_check" check ("content_sha256" ~ '^[0-9a-f]{64}$')
    );`)
    this.addSql('create unique index if not exists "IDX_b2bevd_idempotency" on "b2b_buyer_application_evidence" ("tenant_id","idempotency_key") where "deleted_at" is null;')
    this.addSql('create unique index if not exists "IDX_b2bevd_document_version" on "b2b_buyer_application_evidence" ("application_id","canonical_document_id","document_version") where "deleted_at" is null;')
    this.addSql(`create table if not exists "b2b_buyer_application_evidence_decision" (
      "id" text not null, "application_id" text not null, "evidence_id" text not null,
      "tenant_id" text not null, "decision" text check ("decision" in ('VERIFIED','REJECTED')) not null,
      "reviewer_principal_id" text not null, "decision_reference" text not null,
      "reason_code" text not null, "note" text null, "idempotency_key" text not null,
      "request_hash" text not null, "decided_at" timestamptz not null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null,
      constraint "b2b_buyer_application_evidence_decision_pkey" primary key ("id")
    );`)
    this.addSql('create unique index if not exists "IDX_b2bevdec_evidence" on "b2b_buyer_application_evidence_decision" ("evidence_id") where "deleted_at" is null;')
    this.addSql('create unique index if not exists "IDX_b2bevdec_idempotency" on "b2b_buyer_application_evidence_decision" ("tenant_id","idempotency_key") where "deleted_at" is null;')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "b2b_buyer_application_evidence_decision" cascade;')
    this.addSql('drop table if exists "b2b_buyer_application_evidence" cascade;')
  }
}
