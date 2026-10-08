import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Gate ZB-06 — align product trade profile and market eligibility with ADR-0030.
 */
export class Migration20260920140000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table if exists "b2b_product_trade_profile"
        drop constraint if exists "b2b_product_trade_profile_trade_uom_check";
    `)
    this.addSql(`
      alter table if exists "b2b_product_trade_profile"
        alter column "trade_uom" type text,
        alter column "net_weight_kg" drop not null,
        alter column "gross_weight_kg" drop not null,
        alter column "packaging" drop not null,
        alter column "export_eligibility_reference" drop not null,
        alter column "commodity_attributes" drop not null;
    `)
    this.addSql(`
      alter table if exists "b2b_product_trade_profile"
        add column if not exists "classification_system" text not null default 'HS',
        add column if not exists "classification_confidence" text
          check ("classification_confidence" in (
            'PROPOSED','UNDER_REVIEW','VERIFIED','AUTHORITATIVE','DISPUTED','EXPIRED'
          )) not null default 'PROPOSED';
    `)

    this.addSql(`
      alter table if exists "b2b_market_product_eligibility"
        add column if not exists "regulatory_eligibility" text
          check ("regulatory_eligibility" in (
            'NOT_EVALUATED','PENDING','ELIGIBLE','ELIGIBLE_WITH_CONDITIONS',
            'REVIEW_REQUIRED','INELIGIBLE','SUSPENDED','EXPIRED','ERROR'
          )) not null default 'NOT_EVALUATED',
        add column if not exists "effective_from" timestamptz null,
        add column if not exists "effective_until" timestamptz null;
    `)
    this.addSql(`
      alter table if exists "b2b_market_product_eligibility"
        alter column "policy_reference" drop not null;
    `)

    this.addSql(`
      alter table if exists "b2b_purchase_constraint"
        drop constraint if exists "b2b_purchase_constraint_trade_uom_check";
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table if exists "b2b_product_trade_profile"
        drop column if exists "classification_system",
        drop column if exists "classification_confidence";
    `)
    this.addSql(`
      alter table if exists "b2b_market_product_eligibility"
        drop column if exists "regulatory_eligibility",
        drop column if exists "effective_from",
        drop column if exists "effective_until";
    `)
  }
}
