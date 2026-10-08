import { Migration } from "@medusajs/framework/mikro-orm/migrations"
export class Migration20260908093000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `create table if not exists "trade_lane_policy" ("id" text not null, "policy_reference" text not null, "policy_version" text not null, "origin_country" text not null, "destination_country" text not null, "permitted_incoterms" jsonb not null, "permitted_trade_uoms" jsonb not null, "effective_from" timestamptz not null, "effective_until" timestamptz null, "source" text not null, "status" text check ("status" in ('ACTIVE','SUPERSEDED','REVOKED')) not null default 'ACTIVE', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trade_lane_policy_pkey" primary key ("id"), constraint "trade_lane_countries_check" check ("origin_country" <> "destination_country"), constraint "trade_lane_period_check" check ("effective_until" is null or "effective_until" > "effective_from"));`,
    )
    this.addSql(
      `create table if not exists "trade_compliance_decision" ("id" text not null, "decision_reference" text not null, "transaction_reference" text not null, "status" text check ("status" in ('APPROVED','REJECTED','REVIEW_REQUIRED')) not null, "policy_reference" text not null, "policy_version" text not null, "reasons" jsonb not null, "decided_at" timestamptz not null, "expires_at" timestamptz null, "source" text not null, "source_idempotency_key" text not null, "correlation_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trade_compliance_decision_pkey" primary key ("id"));`,
    )
    this.addSql(
      `create table if not exists "cross_border_transaction" ("id" text not null, "transaction_reference" text not null, "order_reference" text not null, "market_key" text not null, "legal_seller_key" text not null, "exporter_organisation_id" text not null, "importer_organisation_id" text not null, "origin_country" text not null, "destination_country" text not null, "incoterm" text not null, "customs_procedure_reference" text not null, "export_eligibility_reference" text not null, "exporter_registration_reference" text not null, "importer_registration_reference" text not null, "customs_declaration_reference" text null, "export_permit_reference" text null, "trade_lines" jsonb not null, "compliance_decision_id" text not null, "status" text check ("status" in ('READY','REVIEW_REQUIRED','BLOCKED')) not null default 'READY', "source_idempotency_key" text not null, "correlation_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cross_border_transaction_pkey" primary key ("id"), constraint "cross_border_decision_fk" foreign key ("compliance_decision_id") references "trade_compliance_decision" ("id") on delete restrict, constraint "cross_border_countries_check" check ("origin_country" <> "destination_country"));`,
    )
    for (const sql of [
      `create unique index if not exists "IDX_trade_lane_version" on "trade_lane_policy" ("policy_reference", "policy_version") where "deleted_at" is null`,
      `create unique index if not exists "IDX_trade_decision_reference" on "trade_compliance_decision" ("decision_reference") where "deleted_at" is null`,
      `create unique index if not exists "IDX_trade_decision_idempotency" on "trade_compliance_decision" ("source_idempotency_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_cross_border_reference" on "cross_border_transaction" ("transaction_reference") where "deleted_at" is null`,
      `create unique index if not exists "IDX_cross_border_idempotency" on "cross_border_transaction" ("source_idempotency_key") where "deleted_at" is null`,
    ])
      this.addSql(`${sql};`)
  }
  async down(): Promise<void> {
    this.addSql('drop table if exists "cross_border_transaction" cascade;')
    this.addSql('drop table if exists "trade_compliance_decision" cascade;')
    this.addSql('drop table if exists "trade_lane_policy" cascade;')
  }
}
