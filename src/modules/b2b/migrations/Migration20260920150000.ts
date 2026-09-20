import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260920150000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "b2b_buyer_application_decision" add column if not exists "buyer_organisation_id" text null;')
    this.addSql('alter table "b2b_buyer_application_decision" add column if not exists "idempotency_key" text null;')
    this.addSql('alter table "b2b_buyer_application_decision" add column if not exists "request_hash" text null;')
    this.addSql('alter table "b2b_buyer_application_decision" alter column "reason_code" set not null;')
    this.addSql(`create unique index if not exists "IDX_b2b_buyer_decision_idempotency"
      on "b2b_buyer_application_decision" ("idempotency_key")
      where "deleted_at" is null and "idempotency_key" is not null;`)
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "IDX_b2b_buyer_decision_idempotency";')
    this.addSql('alter table "b2b_buyer_application_decision" drop column if exists "request_hash";')
    this.addSql('alter table "b2b_buyer_application_decision" drop column if exists "idempotency_key";')
    this.addSql('alter table "b2b_buyer_application_decision" drop column if exists "buyer_organisation_id";')
    this.addSql('alter table "b2b_buyer_application_decision" alter column "reason_code" drop not null;')
  }
}
