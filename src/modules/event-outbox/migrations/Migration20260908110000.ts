import { Migration } from "@medusajs/framework/mikro-orm/migrations"
export class Migration20260908110000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `create table if not exists "event_outbox" ("id" text not null, "event_id" text not null, "event_type" text not null, "subject" text not null, "tenant_id" text null, "correlation_id" text not null, "causation_id" text null, "idempotency_key" text not null, "envelope" jsonb not null, "status" text check ("status" in ('PENDING','PUBLISHING','PUBLISHED','RETRY','DEAD_LETTER')) not null default 'PENDING', "attempt_count" integer not null default 0, "next_attempt_at" timestamptz not null, "published_at" timestamptz null, "lease_expires_at" timestamptz null, "last_error_code" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "event_outbox_pkey" primary key ("id"), constraint "event_outbox_attempt_check" check ("attempt_count" >= 0));`,
    )
    this.addSql(
      `create table if not exists "event_consumer_receipt" ("id" text not null, "consumer_name" text not null, "event_id" text not null, "event_type" text not null, "correlation_id" text not null, "processed_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "event_consumer_receipt_pkey" primary key ("id"));`,
    )
    this.addSql(
      `create table if not exists "event_reconciliation" ("id" text not null, "outbox_id" text not null, "event_id" text not null, "status" text check ("status" in ('MATCHED','PENDING','RETRY_DUE','ACTION_REQUIRED','RESOLVED')) not null, "reason" text null, "source_idempotency_key" text not null, "observed_at" timestamptz not null, "resolved_at" timestamptz null, "resolution_note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "event_reconciliation_pkey" primary key ("id"));`,
    )
    for (const sql of [
      `create unique index if not exists "IDX_event_outbox_event" on "event_outbox" ("event_id") where "deleted_at" is null`,
      `create unique index if not exists "IDX_event_outbox_idempotency" on "event_outbox" ("idempotency_key") where "deleted_at" is null`,
      `create index if not exists "IDX_event_outbox_dispatch" on "event_outbox" ("status", "next_attempt_at") where "deleted_at" is null`,
      `create unique index if not exists "IDX_event_receipt_consumer_event" on "event_consumer_receipt" ("consumer_name", "event_id") where "deleted_at" is null`,
      `create unique index if not exists "IDX_event_reconciliation_idempotency" on "event_reconciliation" ("source_idempotency_key") where "deleted_at" is null`,
    ])
      this.addSql(`${sql};`)
  }
  async down(): Promise<void> {
    this.addSql('drop table if exists "event_reconciliation" cascade;')
    this.addSql('drop table if exists "event_consumer_receipt" cascade;')
    this.addSql('drop table if exists "event_outbox" cascade;')
  }
}
