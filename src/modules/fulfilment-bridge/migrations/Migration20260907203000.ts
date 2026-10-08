import { Migration } from "@medusajs/framework/mikro-orm/migrations"
export class Migration20260907203000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `create table if not exists "fulfilment_policy_binding" ("id" text not null, "market_key" text not null, "country_code" text not null, "legal_seller_key" text not null, "provider_bindings" jsonb not null, "status" text check ("status" in ('ACTIVE','SUSPENDED')) not null default 'ACTIVE', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "fulfilment_policy_binding_pkey" primary key ("id"));`,
    )
    this.addSql(
      `create table if not exists "commerce_fulfilment" ("id" text not null, "fulfilment_reference" text not null, "order_reference" text not null, "organisation_id" text not null, "market_key" text not null, "legal_seller_key" text not null, "source_location_key" text not null, "mode" text check ("mode" in ('LOCAL_DELIVERY','BULK_FREIGHT','CROSS_BORDER','CUSTOMER_COLLECTION')) not null, "provider_key" text not null, "status" text check ("status" in ('REQUESTED','ACCEPTED','ALLOCATED','DISPATCHED','DELIVERED','CANCELLED','EXCEPTION','RECONCILIATION_REQUIRED')) not null, "shipment_metadata" jsonb not null, "shipment_reference" text null, "carrier_reference" text null, "tracking_reference" text null, "tracking_url" text null, "dispatch_date" timestamptz null, "delivery_date" timestamptz null, "source_idempotency_key" text not null, "correlation_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "commerce_fulfilment_pkey" primary key ("id"));`,
    )
    this.addSql(
      `create table if not exists "fulfilment_status_transition" ("id" text not null, "fulfilment_id" text not null, "from_status" text not null, "to_status" text not null, "idempotency_key" text not null, "evidence" jsonb not null, "occurred_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "fulfilment_status_transition_pkey" primary key ("id"), constraint "fulfilment_transition_fk" foreign key ("fulfilment_id") references "commerce_fulfilment" ("id") on delete cascade);`,
    )
    this.addSql(
      `create table if not exists "fulfilment_reconciliation" ("id" text not null, "fulfilment_id" text not null, "execution_reference" text null, "commerce_status" text not null, "execution_status" text null, "status" text check ("status" in ('MATCHED','VARIANCE','PENDING_EXECUTION','RESOLVED')) not null, "reasons" jsonb not null, "source_idempotency_key" text not null, "observed_at" timestamptz not null, "resolved_at" timestamptz null, "resolution_note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "fulfilment_reconciliation_pkey" primary key ("id"), constraint "fulfilment_reconciliation_fk" foreign key ("fulfilment_id") references "commerce_fulfilment" ("id") on delete cascade);`,
    )
    for (const sql of [
      `create unique index if not exists "IDX_fulfilment_policy_market" on "fulfilment_policy_binding" ("market_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_fulfilment_reference" on "commerce_fulfilment" ("fulfilment_reference") where "deleted_at" is null`,
      `create unique index if not exists "IDX_fulfilment_idempotency" on "commerce_fulfilment" ("source_idempotency_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_fulfilment_transition_idempotency" on "fulfilment_status_transition" ("idempotency_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_fulfilment_reconciliation_idempotency" on "fulfilment_reconciliation" ("source_idempotency_key") where "deleted_at" is null`,
    ])
      this.addSql(`${sql};`)
  }
  async down(): Promise<void> {
    this.addSql('drop table if exists "fulfilment_reconciliation" cascade;')
    this.addSql('drop table if exists "fulfilment_status_transition" cascade;')
    this.addSql('drop table if exists "commerce_fulfilment" cascade;')
    this.addSql('drop table if exists "fulfilment_policy_binding" cascade;')
  }
}
