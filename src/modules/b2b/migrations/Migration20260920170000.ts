import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260920170000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "b2b_buyer_membership" alter column "customer_id" drop not null;')
    this.addSql('alter table "b2b_buyer_membership" alter column "principal_id" drop not null;')
    this.addSql('alter table "b2b_buyer_membership" add column if not exists "invitation_idempotency_key" text null;')
    this.addSql('alter table "b2b_buyer_membership" add column if not exists "invitation_request_hash" text null;')
    this.addSql(`create unique index if not exists "IDX_b2b_buyer_invitation_idempotency"
      on "b2b_buyer_membership" ("invitation_idempotency_key")
      where "deleted_at" is null and "invitation_idempotency_key" is not null;`)
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "IDX_b2b_buyer_invitation_idempotency";')
    this.addSql('alter table "b2b_buyer_membership" drop column if exists "invitation_request_hash";')
    this.addSql('alter table "b2b_buyer_membership" drop column if exists "invitation_idempotency_key";')
    this.addSql(`delete from "b2b_buyer_membership"
      where "customer_id" is null or "principal_id" is null;`)
    this.addSql('alter table "b2b_buyer_membership" alter column "customer_id" set not null;')
    this.addSql('alter table "b2b_buyer_membership" alter column "principal_id" set not null;')
  }
}
