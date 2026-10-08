import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260908230000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "commerce_payment" alter column "organisation_id" drop not null;')
    this.addSql(
      'alter table "commerce_payment" add column if not exists "customer_reference" text null;',
    )
    this.addSql(`alter table "commerce_payment" add constraint "commerce_payment_one_party" check (
      ("organisation_id" is not null and "customer_reference" is null) or
      ("organisation_id" is null and "customer_reference" is not null)
    );`)
    this.addSql(
      `create index if not exists "IDX_commerce_payment_customer" on "commerce_payment" ("customer_reference") where "deleted_at" is null;`,
    )
    this.addSql(`create table if not exists "payment_webhook_receipt" (
      "id" text not null, "provider_key" text not null, "provider_event_id" text not null,
      "payload_sha256" text not null, "signature_verified" boolean not null,
      "occurred_at" timestamptz not null, "processed_at" timestamptz null,
      "processing_status" text check ("processing_status" in ('RECEIVED','PROCESSED','REJECTED')) not null default 'RECEIVED',
      "rejection_reason" text null, "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null,
      constraint "payment_webhook_receipt_pkey" primary key ("id")
    );`)
    this.addSql(
      `create unique index if not exists "IDX_payment_webhook_provider_event" on "payment_webhook_receipt" ("provider_key", "provider_event_id") where "deleted_at" is null;`,
    )
    this.addSql(`create table if not exists "payment_refund" (
      "id" text not null, "refund_reference" text not null, "payment_id" text not null,
      "order_reference" text not null, "provider_key" text not null, "provider_reference" text null,
      "currency_code" text not null, "amount_minor" bigint not null, "raw_amount_minor" jsonb not null,
      "reason" text check ("reason" in ('CUSTOMER_RETURN','ORDER_CANCELLATION','SERVICE_RECOVERY')) not null,
      "status" text check ("status" in ('REQUESTED','SUBMITTED','SUCCEEDED','FAILED')) not null,
      "source_idempotency_key" text not null, "correlation_id" text not null, "failure_code" text null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null, constraint "payment_refund_pkey" primary key ("id"),
      constraint "payment_refund_payment_fk" foreign key ("payment_id") references "commerce_payment" ("id") on delete cascade,
      constraint "payment_refund_positive_amount" check ("amount_minor" > 0)
    );`)
    this.addSql(
      `create unique index if not exists "IDX_payment_refund_reference" on "payment_refund" ("refund_reference") where "deleted_at" is null;`,
    )
    this.addSql(
      `create unique index if not exists "IDX_payment_refund_idempotency" on "payment_refund" ("source_idempotency_key") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "payment_refund" cascade;')
    this.addSql('drop table if exists "payment_webhook_receipt" cascade;')
    this.addSql(
      'alter table "commerce_payment" drop constraint if exists "commerce_payment_one_party";',
    )
    this.addSql('drop index if exists "IDX_commerce_payment_customer";')
    this.addSql('alter table "commerce_payment" drop column if exists "customer_reference";')
    this.addSql('alter table "commerce_payment" alter column "organisation_id" set not null;')
  }
}
