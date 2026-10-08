import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260909090000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "erp_projection" add column if not exists "command_digest" text;')
    for (const [table, column, values] of [
      [
        "erp_projection",
        "kind",
        "'PRODUCT','SUPPLIER','WAREHOUSE','ORDER','FULFILMENT','SHIPMENT','PAYMENT','RETURN_REFUND'",
      ],
      [
        "erp_entity_mapping",
        "mapping_type",
        "'BUSINESS_PARTNER','PRODUCT','WAREHOUSE','SALES_ORDER','SHIPMENT','FINANCIAL_CONSEQUENCE','SUPPLIER','PAYMENT','RETURN_REFUND'",
      ],
      [
        "erp_integration_reconciliation",
        "projection_kind",
        "'BUSINESS_PARTNER','PRODUCT','WAREHOUSE','ORDER','FULFILMENT','FINANCIAL_STATUS','SUPPLIER','SHIPMENT','PAYMENT','RETURN_REFUND'",
      ],
    ] as const) {
      this.addSql(`alter table "${table}" drop constraint if exists "${table}_${column}_check";`)
      this.addSql(
        `alter table "${table}" add constraint "${table}_${column}_check" check ("${column}" in (${values}));`,
      )
    }
  }

  async down(): Promise<void> {
    // This migration only ever widened the three CHECK constraints below to admit new enum
    // values for Thamani's Gate 15. A prior version of down() tried to narrow them back by
    // deleting every row carrying one of the newly admitted values — but PRODUCT, WAREHOUSE, and
    // SHIPMENT are enum values ZuriBeans' own Gate 12 already used before this migration ran, so
    // that delete was not scoped to Thamani at all: rolling back this migration on a database
    // that also carries ZuriBeans data destroyed ZuriBeans' rows too. Narrowing a CHECK
    // constraint back down after rows using the wider set already exist is fundamentally
    // destructive (there is no way to do it without deleting those rows), so down() leaves the
    // wider constraints in place instead — safe, and consistent with not destroying data across
    // Digital Estates on rollback.
    this.addSql('alter table "erp_projection" drop column if exists "command_digest";')
  }
}
