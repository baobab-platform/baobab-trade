import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260909180000 extends Migration {
  async up(): Promise<void> {
    // Gate 17 (Store Credit) adds a CREDIT_LINE projection kind alongside the
    // seven Gate 15 kinds — the TypeScript `ProjectionKind` union isn't
    // enforced at the database layer, so these three CHECK constraints (see
    // Migration20260909090000) must be widened here too, or every CREDIT_LINE
    // insert fails with `erp_projection_kind_check`.
    for (const [table, column, values] of [
      [
        "erp_projection",
        "kind",
        "'PRODUCT','SUPPLIER','WAREHOUSE','ORDER','FULFILMENT','SHIPMENT','PAYMENT','RETURN_REFUND','CREDIT_LINE'",
      ],
      [
        "erp_entity_mapping",
        "mapping_type",
        "'BUSINESS_PARTNER','PRODUCT','WAREHOUSE','SALES_ORDER','SHIPMENT','FINANCIAL_CONSEQUENCE','SUPPLIER','PAYMENT','RETURN_REFUND','CREDIT_LINE'",
      ],
      [
        "erp_integration_reconciliation",
        "projection_kind",
        "'BUSINESS_PARTNER','PRODUCT','WAREHOUSE','ORDER','FULFILMENT','FINANCIAL_STATUS','SUPPLIER','SHIPMENT','PAYMENT','RETURN_REFUND','CREDIT_LINE'",
      ],
    ] as const) {
      this.addSql(`alter table "${table}" drop constraint if exists "${table}_${column}_check";`)
      this.addSql(
        `alter table "${table}" add constraint "${table}_${column}_check" check ("${column}" in (${values}));`,
      )
    }
  }

  async down(): Promise<void> {
    // Narrowing a CHECK constraint back down after rows using the wider set
    // already exist is destructive (Migration20260909090000's own down()
    // explains why in detail), so, consistent with that migration, down()
    // here is a no-op and leaves the wider constraints in place.
  }
}
