import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260909130000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "trade_lane_policy" add column if not exists "digital_estate" text null;',
    )
    // Every trade_lane_policy row created before this migration was ZuriBeans' own (Gate 11) —
    // Thamani's Gate 14 read/wrote the same shared rows rather than creating its own, which is
    // exactly the cross-estate coupling this migration closes.
    this.addSql(
      `update "trade_lane_policy" set "digital_estate" = 'estate:zuribeans-b2b' where "digital_estate" is null;`,
    )
    this.addSql('alter table "trade_lane_policy" alter column "digital_estate" set not null;')
    this.addSql(
      `alter table "trade_lane_policy" add constraint "trade_lane_digital_estate_check" check ("digital_estate" in ('estate:zuribeans-b2b','estate:thamani-b2c'));`,
    )
    this.addSql('drop index if exists "IDX_trade_lane_version";')
    this.addSql(
      `create unique index if not exists "IDX_trade_lane_version" on "trade_lane_policy" ("digital_estate", "policy_reference", "policy_version") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "IDX_trade_lane_version";')
    this.addSql(
      `create unique index if not exists "IDX_trade_lane_version" on "trade_lane_policy" ("policy_reference", "policy_version") where "deleted_at" is null;`,
    )
    this.addSql(
      'alter table "trade_lane_policy" drop constraint if exists "trade_lane_digital_estate_check";',
    )
    this.addSql('alter table "trade_lane_policy" drop column if exists "digital_estate";')
  }
}
