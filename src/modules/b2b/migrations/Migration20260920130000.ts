import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260920130000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "b2b_buyer_application_review_action" (
      "id" text not null,
      "application_id" text not null,
      "tenant_id" text not null,
      "from_status" text check ("from_status" in ('SUBMITTED','UNDER_REVIEW')) not null,
      "to_status" text check ("to_status" in ('INFORMATION_REQUIRED','UNDER_REVIEW')) not null,
      "reviewer_principal_id" text not null,
      "reason_code" text not null,
      "note" text null,
      "application_revision" integer not null,
      "idempotency_key" text not null,
      "request_hash" text not null,
      "action_at" timestamptz not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_buyer_application_review_action_pkey" primary key ("id"),
      constraint "b2b_buyer_application_review_action_application_fk"
        foreign key ("application_id") references "b2b_buyer_application" ("id") on delete restrict,
      constraint "b2b_buyer_application_review_action_revision_positive"
        check ("application_revision" > 1)
    );`)

    this.addSql(`create unique index if not exists "IDX_b2b_buyer_review_revision"
      on "b2b_buyer_application_review_action" ("application_id", "application_revision")
      where "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_b2b_buyer_review_idempotency"
      on "b2b_buyer_application_review_action" ("tenant_id", "idempotency_key")
      where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_b2b_buyer_review_reviewer"
      on "b2b_buyer_application_review_action" ("reviewer_principal_id", "action_at")
      where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "b2b_buyer_application_review_action" cascade;')
  }
}
