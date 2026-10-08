import { Migration } from "@medusajs/framework/mikro-orm/migrations"
export class Migration20260908100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `create table if not exists "erp_entity_mapping" ("id" text not null, "mapping_type" text check ("mapping_type" in ('BUSINESS_PARTNER','PRODUCT','WAREHOUSE','SALES_ORDER','SHIPMENT','FINANCIAL_CONSEQUENCE')) not null, "canonical_entity_id" text not null, "medusa_entity_type" text not null, "medusa_native_id" text not null, "erp_entity_type" text not null, "erp_native_id" text not null, "external_reference" text not null, "source_authority" text check ("source_authority" in ('CONTROL_PLANE','ERP','TRADE_PENDING_REGISTRATION')) not null, "status" text check ("status" in ('ACTIVE','UNVERIFIED','SUSPECT','ARCHIVED')) not null default 'UNVERIFIED', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "erp_entity_mapping_pkey" primary key ("id"));`,
    )
    this.addSql(
      `create table if not exists "erp_projection" ("id" text not null, "kind" text check ("kind" in ('ORDER','FULFILMENT')) not null, "commerce_reference" text not null, "canonical_entity_id" text not null, "legal_seller_key" text not null, "market_key" text not null, "payload" jsonb not null, "status" text check ("status" in ('PENDING','PUBLISHED','ACKNOWLEDGED','FAILED','RECONCILIATION_REQUIRED')) not null default 'PENDING', "erp_reference" text null, "attempt_count" integer not null default 0, "last_error_code" text null, "next_attempt_at" timestamptz null, "source_idempotency_key" text not null, "correlation_id" text not null, "acknowledged_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "erp_projection_pkey" primary key ("id"), constraint "erp_projection_attempt_check" check ("attempt_count" >= 0));`,
    )
    this.addSql(
      `create table if not exists "erp_financial_status_projection" ("id" text not null, "commerce_payment_reference" text not null, "erp_payment_reference" text not null, "status" text check ("status" in ('OPEN','PARTIALLY_PAID','PAID','OVERDUE','CREDIT_HOLD','CANCELLED')) not null, "amount_minor" bigint not null, "raw_amount_minor" jsonb not null, "outstanding_minor" bigint not null, "raw_outstanding_minor" jsonb not null, "currency_code" text not null, "source_sequence" integer not null, "source_idempotency_key" text not null, "observed_at" timestamptz not null, "applied_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "erp_financial_status_projection_pkey" primary key ("id"), constraint "erp_financial_amount_check" check ("source_sequence" > 0 and "amount_minor" >= 0 and "outstanding_minor" >= 0 and "outstanding_minor" <= "amount_minor"));`,
    )
    this.addSql(
      `create table if not exists "erp_integration_reconciliation" ("id" text not null, "projection_kind" text check ("projection_kind" in ('BUSINESS_PARTNER','PRODUCT','WAREHOUSE','ORDER','FULFILMENT','FINANCIAL_STATUS')) not null, "commerce_reference" text not null, "erp_reference" text null, "expected_state" jsonb not null, "observed_state" jsonb null, "differences" jsonb not null, "status" text check ("status" in ('MATCHED','VARIANCE','PENDING_ERP','RESOLVED')) not null, "source_idempotency_key" text not null, "observed_at" timestamptz not null, "resolved_at" timestamptz null, "resolution_note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "erp_integration_reconciliation_pkey" primary key ("id"));`,
    )
    for (const sql of [
      `create unique index if not exists "IDX_erp_mapping_canonical" on "erp_entity_mapping" ("mapping_type", "canonical_entity_id") where "deleted_at" is null`,
      `create unique index if not exists "IDX_erp_mapping_native" on "erp_entity_mapping" ("erp_entity_type", "erp_native_id") where "deleted_at" is null`,
      `create unique index if not exists "IDX_erp_mapping_external" on "erp_entity_mapping" ("external_reference") where "deleted_at" is null`,
      `create unique index if not exists "IDX_erp_projection_idempotency" on "erp_projection" ("source_idempotency_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_erp_financial_sequence" on "erp_financial_status_projection" ("commerce_payment_reference", "source_sequence") where "deleted_at" is null`,
      `create unique index if not exists "IDX_erp_financial_idempotency" on "erp_financial_status_projection" ("source_idempotency_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_erp_reconciliation_idempotency" on "erp_integration_reconciliation" ("source_idempotency_key") where "deleted_at" is null`,
    ])
      this.addSql(`${sql};`)
  }
  async down(): Promise<void> {
    this.addSql('drop table if exists "erp_integration_reconciliation" cascade;')
    this.addSql('drop table if exists "erp_financial_status_projection" cascade;')
    this.addSql('drop table if exists "erp_projection" cascade;')
    this.addSql('drop table if exists "erp_entity_mapping" cascade;')
  }
}
