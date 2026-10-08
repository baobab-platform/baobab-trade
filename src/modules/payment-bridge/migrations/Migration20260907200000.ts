import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260907200000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "payment_policy_binding" (
      "id" text not null, "market_key" text not null, "legal_seller_key" text not null,
      "currency_code" text not null, "default_terms" text not null, "allowed_terms" jsonb not null,
      "provider_bindings" jsonb not null, "status" text check ("status" in ('ACTIVE','SUSPENDED')) not null default 'ACTIVE',
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null,
      constraint "payment_policy_binding_pkey" primary key ("id")
    );`)
    this.addSql(`create table if not exists "commerce_payment" (
      "id" text not null, "payment_reference" text not null, "order_reference" text not null,
      "organisation_id" text not null, "market_key" text not null, "legal_seller_key" text not null,
      "method" text check ("method" in ('BANK_TRANSFER','MANUAL_SETTLEMENT','INVOICE_TERMS','SELECTED_PSP')) not null,
      "terms" text check ("terms" in ('PREPAID','DUE_ON_RECEIPT','NET_7','NET_14','NET_30')) not null,
      "provider_key" text not null, "provider_reference" text null, "provider_status" text null,
      "currency_code" text not null, "amount_minor" bigint not null, "raw_amount_minor" jsonb not null,
      "status" text check ("status" in ('CREATED','PENDING','AUTHORIZED','CAPTURED','SETTLED','FAILED','CANCELLED','UNKNOWN')) not null,
      "source_idempotency_key" text not null, "correlation_id" text not null, "due_at" timestamptz null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null,
      constraint "commerce_payment_pkey" primary key ("id"), constraint "commerce_payment_positive_amount" check ("amount_minor" > 0)
    );`)
    this.addSql(`create table if not exists "payment_status_transition" (
      "id" text not null, "payment_id" text not null, "from_status" text not null, "to_status" text not null,
      "idempotency_key" text not null, "provider_reference" text null, "provider_status" text null,
      "occurred_at" timestamptz not null, "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null,
      constraint "payment_status_transition_pkey" primary key ("id"),
      constraint "payment_transition_payment_fk" foreign key ("payment_id") references "commerce_payment" ("id") on delete cascade
    );`)
    this.addSql(`create table if not exists "payment_erp_reconciliation" (
      "id" text not null, "payment_id" text not null, "erp_payment_reference" text null,
      "commerce_status" text not null, "erp_status" text null, "commerce_amount_minor" bigint not null,
      "raw_commerce_amount_minor" jsonb not null, "erp_amount_minor" bigint null, "raw_erp_amount_minor" jsonb null,
      "commerce_currency" text not null, "erp_currency" text null,
      "amount_delta_minor" bigint not null, "raw_amount_delta_minor" jsonb not null,
      "status" text check ("status" in ('MATCHED','VARIANCE','PENDING_ERP','RESOLVED')) not null,
      "reasons" jsonb not null, "source_idempotency_key" text not null, "observed_at" timestamptz not null,
      "resolved_at" timestamptz null, "resolution_note" text null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null,
      constraint "payment_erp_reconciliation_pkey" primary key ("id"),
      constraint "payment_reconciliation_payment_fk" foreign key ("payment_id") references "commerce_payment" ("id") on delete cascade,
      constraint "payment_reconciliation_positive_amount" check ("commerce_amount_minor" > 0)
    );`)
    for (const sql of [
      `create unique index if not exists "IDX_payment_policy_market_currency" on "payment_policy_binding" ("market_key", "currency_code") where "deleted_at" is null`,
      `create unique index if not exists "IDX_commerce_payment_reference" on "commerce_payment" ("payment_reference") where "deleted_at" is null`,
      `create unique index if not exists "IDX_commerce_payment_idempotency" on "commerce_payment" ("source_idempotency_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_payment_transition_idempotency" on "payment_status_transition" ("idempotency_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_payment_reconciliation_idempotency" on "payment_erp_reconciliation" ("source_idempotency_key") where "deleted_at" is null`,
    ])
      this.addSql(`${sql};`)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "payment_erp_reconciliation" cascade;')
    this.addSql('drop table if exists "payment_status_transition" cascade;')
    this.addSql('drop table if exists "commerce_payment" cascade;')
    this.addSql('drop table if exists "payment_policy_binding" cascade;')
  }
}
