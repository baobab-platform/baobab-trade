import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260920230000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "b2b_buyer_invitation_delivery" (
      "id" text not null, "membership_id" text not null, "attempt_number" integer not null,
      "status" text check ("status" in ('PENDING','QUEUED','FAILED')) not null,
      "requested_by_principal_id" text not null, "provider_message_id" text null,
      "error_code" text null, "attempted_at" timestamptz not null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null, constraint "b2b_buyer_invitation_delivery_pkey" primary key ("id"),
      constraint "b2b_buyer_invitation_delivery_attempt_check" check ("attempt_number" > 0)
    );`)
    this.addSql('create unique index if not exists "IDX_b2binvdel_attempt" on "b2b_buyer_invitation_delivery" ("membership_id","attempt_number") where "deleted_at" is null;')
    this.addSql('create index if not exists "IDX_b2binvdel_status" on "b2b_buyer_invitation_delivery" ("status") where "deleted_at" is null;')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "b2b_buyer_invitation_delivery" cascade;')
  }
}
