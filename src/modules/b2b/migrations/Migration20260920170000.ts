import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260920170000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "b2b_buyer_membership" alter column "customer_id" drop not null;')
    this.addSql('alter table "b2b_buyer_membership" alter column "principal_id" drop not null;')
  }

  async down(): Promise<void> {
    this.addSql(`delete from "b2b_buyer_membership"
      where "customer_id" is null or "principal_id" is null;`)
    this.addSql('alter table "b2b_buyer_membership" alter column "customer_id" set not null;')
    this.addSql('alter table "b2b_buyer_membership" alter column "principal_id" set not null;')
  }
}
