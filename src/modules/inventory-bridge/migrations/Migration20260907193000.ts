import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260907193000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "inventory_location_mapping" (
      "id" text not null,
      "stock_location_id" text not null,
      "canonical_location_key" text not null,
      "erp_warehouse_reference" text not null,
      "market_key" text not null,
      "status" text check ("status" in ('ACTIVE','SUSPENDED','RETIRED')) not null default 'ACTIVE',
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "inventory_location_mapping_pkey" primary key ("id")
    );`)

    this.addSql(`create table if not exists "inventory_erp_projection" (
      "id" text not null,
      "inventory_item_id" text not null,
      "stock_location_id" text not null,
      "erp_warehouse_reference" text not null,
      "source_sequence" integer not null,
      "source_idempotency_key" text not null,
      "on_hand_quantity" integer not null,
      "incoming_quantity" integer not null default 0,
      "unavailable_quantity" integer not null default 0,
      "projected_at" timestamptz not null,
      "applied_at" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "inventory_erp_projection_pkey" primary key ("id"),
      constraint "inventory_erp_projection_nonnegative_check" check ("source_sequence" > 0 and "on_hand_quantity" >= 0 and "incoming_quantity" >= 0 and "unavailable_quantity" >= 0)
    );`)

    this.addSql(`create table if not exists "inventory_reconciliation" (
      "id" text not null,
      "projection_id" text not null,
      "inventory_item_id" text not null,
      "stock_location_id" text not null,
      "erp_on_hand_quantity" integer not null,
      "medusa_stocked_quantity" integer not null,
      "medusa_reserved_quantity" integer not null,
      "delta_quantity" integer not null,
      "status" text check ("status" in ('MATCHED','VARIANCE','RESOLVED')) not null,
      "observed_at" timestamptz not null,
      "resolved_at" timestamptz null,
      "resolution_note" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "inventory_reconciliation_pkey" primary key ("id"),
      constraint "inventory_reconciliation_projection_fk" foreign key ("projection_id") references "inventory_erp_projection" ("id") on delete cascade,
      constraint "inventory_reconciliation_nonnegative_check" check ("erp_on_hand_quantity" >= 0 and "medusa_stocked_quantity" >= 0 and "medusa_reserved_quantity" >= 0)
    );`)

    for (const sql of [
      `create unique index if not exists "IDX_inventory_location_stock" on "inventory_location_mapping" ("stock_location_id") where "deleted_at" is null`,
      `create unique index if not exists "IDX_inventory_location_canonical" on "inventory_location_mapping" ("canonical_location_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_inventory_location_erp" on "inventory_location_mapping" ("erp_warehouse_reference") where "deleted_at" is null`,
      `create unique index if not exists "IDX_inventory_projection_idempotency" on "inventory_erp_projection" ("source_idempotency_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_inventory_projection_sequence" on "inventory_erp_projection" ("inventory_item_id", "stock_location_id", "source_sequence") where "deleted_at" is null`,
      `create unique index if not exists "IDX_inventory_reconciliation_projection" on "inventory_reconciliation" ("projection_id") where "deleted_at" is null`,
    ]) {
      this.addSql(`${sql};`)
    }
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "inventory_reconciliation" cascade;')
    this.addSql('drop table if exists "inventory_erp_projection" cascade;')
    this.addSql('drop table if exists "inventory_location_mapping" cascade;')
  }
}
