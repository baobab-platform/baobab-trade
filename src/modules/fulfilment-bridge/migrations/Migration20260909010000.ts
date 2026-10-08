import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260909010000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "commerce_fulfilment" alter column "organisation_id" drop not null;')
    this.addSql(
      'alter table "commerce_fulfilment" add column if not exists "customer_reference" text null;',
    )
    this.addSql(
      'alter table "commerce_fulfilment" drop constraint if exists "commerce_fulfilment_mode_check";',
    )
    this.addSql(
      `alter table "commerce_fulfilment" add constraint "commerce_fulfilment_mode_check" check ("mode" in ('LOCAL_DELIVERY','PARCEL_SHIPMENT','BULK_FREIGHT','CROSS_BORDER','CUSTOMER_COLLECTION'));`,
    )
    this
      .addSql(`alter table "commerce_fulfilment" add constraint "commerce_fulfilment_one_party" check (
      ("organisation_id" is not null and "customer_reference" is null) or
      ("organisation_id" is null and "customer_reference" is not null)
    );`)
    this.addSql(
      `create index if not exists "IDX_commerce_fulfilment_customer" on "commerce_fulfilment" ("customer_reference") where "deleted_at" is null;`,
    )
    this.addSql(`create table if not exists "fulfilment_order_line" (
      "id" text not null, "fulfilment_id" text not null, "order_line_reference" text not null,
      "fulfilled_quantity" integer not null, "returned_quantity" integer not null default 0,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null,
      constraint "fulfilment_order_line_pkey" primary key ("id"),
      constraint "fulfilment_order_line_fk" foreign key ("fulfilment_id") references "commerce_fulfilment" ("id") on delete cascade,
      constraint "fulfilment_order_line_positive" check ("fulfilled_quantity" > 0),
      constraint "fulfilment_order_line_returned" check ("returned_quantity" >= 0 and "returned_quantity" <= "fulfilled_quantity"),
      constraint "fulfilment_order_line_identity" unique ("fulfilment_id", "order_line_reference")
    );`)
    this.addSql(`create table if not exists "fulfilment_allocation" (
      "id" text not null, "fulfilment_id" text not null, "order_line_reference" text not null,
      "source_location_key" text not null, "quantity" integer not null, "source_idempotency_key" text not null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null, constraint "fulfilment_allocation_pkey" primary key ("id"),
      constraint "fulfilment_allocation_fk" foreign key ("fulfilment_id") references "commerce_fulfilment" ("id") on delete cascade,
      constraint "fulfilment_allocation_line_fk" foreign key ("fulfilment_id", "order_line_reference")
        references "fulfilment_order_line" ("fulfilment_id", "order_line_reference") on delete cascade,
      constraint "fulfilment_allocation_positive" check ("quantity" > 0)
    );`)
    this.addSql(
      `create unique index if not exists "IDX_fulfilment_allocation_idempotency" on "fulfilment_allocation" ("source_idempotency_key") where "deleted_at" is null;`,
    )
    this.addSql(`create table if not exists "commerce_return" (
      "id" text not null, "return_reference" text not null, "fulfilment_id" text not null,
      "order_reference" text not null, "order_line_reference" text not null, "quantity" integer not null,
      "reason" text check ("reason" in ('DAMAGED','WRONG_ITEM','NOT_AS_DESCRIBED','CUSTOMER_REMORSE')) not null,
      "disposition" text check ("disposition" in ('RESTOCK','QUARANTINE','DISPOSE','INSPECT')) not null,
      "status" text check ("status" in ('REQUESTED','AUTHORIZED','RECEIVED','COMPLETED','REJECTED')) not null,
      "source_idempotency_key" text not null, "correlation_id" text not null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null, constraint "commerce_return_pkey" primary key ("id"),
      constraint "commerce_return_fulfilment_fk" foreign key ("fulfilment_id") references "commerce_fulfilment" ("id") on delete cascade,
      constraint "commerce_return_line_fk" foreign key ("fulfilment_id", "order_line_reference")
        references "fulfilment_order_line" ("fulfilment_id", "order_line_reference") on delete restrict,
      constraint "commerce_return_positive" check ("quantity" > 0)
    );`)
    this.addSql(
      `create unique index if not exists "IDX_commerce_return_reference" on "commerce_return" ("return_reference") where "deleted_at" is null;`,
    )
    this.addSql(
      `create unique index if not exists "IDX_commerce_return_idempotency" on "commerce_return" ("source_idempotency_key") where "deleted_at" is null;`,
    )
    this
      .addSql(`create or replace function check_complete_fulfilment_allocation() returns trigger as $$
      declare expected integer; allocated integer; target_fulfilment text; target_line text;
      begin
        target_fulfilment := coalesce(new.fulfilment_id, old.fulfilment_id);
        target_line := coalesce(new.order_line_reference, old.order_line_reference);
        select fulfilled_quantity into expected from fulfilment_order_line
          where fulfilment_id = target_fulfilment and order_line_reference = target_line and deleted_at is null;
        if expected is null then raise exception 'Unknown fulfilment order line %', target_line; end if;
        select coalesce(sum(quantity), 0) into allocated from fulfilment_allocation
          where fulfilment_id = target_fulfilment and order_line_reference = target_line and deleted_at is null;
        if allocated <> expected then raise exception 'Allocation for line % must total %, got %', target_line, expected, allocated; end if;
        return null;
      end; $$ language plpgsql;`)
    this.addSql(`create constraint trigger "fulfilment_allocation_complete"
      after insert or update or delete on "fulfilment_allocation" deferrable initially deferred
      for each row execute function check_complete_fulfilment_allocation();`)
    this.addSql(`create or replace function check_commerce_return_limit() returns trigger as $$
      declare old_quantity integer := 0; new_quantity integer := 0; affected integer;
      begin
        if tg_op <> 'INSERT' and old.deleted_at is null and old.status <> 'REJECTED' then old_quantity := old.quantity; end if;
        if tg_op <> 'DELETE' and new.deleted_at is null and new.status <> 'REJECTED' then new_quantity := new.quantity; end if;
        if tg_op = 'UPDATE' and (new.fulfilment_id <> old.fulfilment_id or new.order_line_reference <> old.order_line_reference)
          then raise exception 'A return cannot move between fulfilment lines'; end if;
        update fulfilment_order_line set returned_quantity = returned_quantity + new_quantity - old_quantity
          where fulfilment_id = coalesce(new.fulfilment_id, old.fulfilment_id)
            and order_line_reference = coalesce(new.order_line_reference, old.order_line_reference)
            and deleted_at is null
            and returned_quantity + new_quantity - old_quantity between 0 and fulfilled_quantity;
        get diagnostics affected = row_count;
        if affected <> 1 then raise exception 'Return exceeds the remaining fulfilled quantity or references an unknown line'; end if;
        return coalesce(new, old);
      end; $$ language plpgsql;`)
    this
      .addSql(`create trigger "commerce_return_limit" before insert or update or delete on "commerce_return"
      for each row execute function check_commerce_return_limit();`)
  }

  async down(): Promise<void> {
    this.addSql('drop trigger if exists "commerce_return_limit" on "commerce_return";')
    this.addSql("drop function if exists check_commerce_return_limit();")
    this.addSql(
      'drop trigger if exists "fulfilment_allocation_complete" on "fulfilment_allocation";',
    )
    this.addSql("drop function if exists check_complete_fulfilment_allocation();")
    this.addSql('drop table if exists "commerce_return" cascade;')
    this.addSql('drop table if exists "fulfilment_allocation" cascade;')
    this.addSql('drop table if exists "fulfilment_order_line" cascade;')
    this.addSql(
      'alter table "commerce_fulfilment" drop constraint if exists "commerce_fulfilment_one_party";',
    )
    this.addSql('drop index if exists "IDX_commerce_fulfilment_customer";')
    this
      .addSql(`update "commerce_fulfilment" set "organisation_id" = 'legacy-b2c:' || "customer_reference"
      where "organisation_id" is null;`)
    this.addSql('alter table "commerce_fulfilment" drop column if exists "customer_reference";')
    this.addSql('alter table "commerce_fulfilment" alter column "organisation_id" set not null;')
    this.addSql(
      'alter table "commerce_fulfilment" drop constraint if exists "commerce_fulfilment_mode_check";',
    )
    this.addSql(
      `alter table "commerce_fulfilment" add constraint "commerce_fulfilment_mode_check" check ("mode" in ('LOCAL_DELIVERY','BULK_FREIGHT','CROSS_BORDER','CUSTOMER_COLLECTION'));`,
    )
  }
}
