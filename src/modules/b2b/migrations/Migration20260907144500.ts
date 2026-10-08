import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260907144500 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "b2b_organisation" (
      "id" text not null,
      "tenant_id" text not null,
      "legal_name" text not null,
      "trading_name" text null,
      "registration_number" text null,
      "status" text check ("status" in ('PENDING','ACTIVE','SUSPENDED','CLOSED')) not null default 'PENDING',
      "canonical_organisation_id" text null,
      "erp_business_partner_id" text null,
      "default_market_key" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_organisation_pkey" primary key ("id")
    );`)

    this.addSql(`create table if not exists "b2b_buyer_membership" (
      "id" text not null,
      "organisation_id" text not null,
      "customer_id" text not null,
      "principal_id" text not null,
      "status" text check ("status" in ('INVITED','ACTIVE','SUSPENDED','REVOKED')) not null default 'INVITED',
      "invited_email" text null,
      "invitation_token_hash" text null,
      "invitation_expires_at" timestamptz null,
      "invitation_accepted_at" timestamptz null,
      "effective_from" timestamptz null,
      "effective_until" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_buyer_membership_pkey" primary key ("id"),
      constraint "b2b_buyer_membership_organisation_fk" foreign key ("organisation_id") references "b2b_organisation" ("id") on delete cascade
    );`)

    this.addSql(`create table if not exists "b2b_buyer_role" (
      "id" text not null,
      "membership_id" text not null,
      "role" text check ("role" in ('BUYER','SENIOR_BUYER','APPROVER','PROCUREMENT_MANAGER','ACCOUNT_ADMIN','VIEWER')) not null,
      "assigned_by_principal_id" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_buyer_role_pkey" primary key ("id"),
      constraint "b2b_buyer_role_membership_fk" foreign key ("membership_id") references "b2b_buyer_membership" ("id") on delete cascade
    );`)

    this.addSql(`create table if not exists "b2b_approval_policy" (
      "id" text not null,
      "organisation_id" text not null,
      "market_key" text null,
      "currency_code" text not null,
      "threshold_minor" numeric null,
      "raw_threshold_minor" jsonb null,
      "enabled" boolean not null default true,
      "product_category_ids" text[] not null default '{}',
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_approval_policy_pkey" primary key ("id"),
      constraint "b2b_approval_policy_organisation_fk" foreign key ("organisation_id") references "b2b_organisation" ("id") on delete cascade
    );`)

    this.addSql(`create table if not exists "b2b_spend_limit" (
      "id" text not null,
      "membership_id" text not null,
      "market_key" text null,
      "currency_code" text not null,
      "order_limit_minor" numeric null,
      "raw_order_limit_minor" jsonb null,
      "approval_limit_minor" numeric null,
      "raw_approval_limit_minor" jsonb null,
      "effective_from" timestamptz null,
      "effective_until" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_spend_limit_pkey" primary key ("id"),
      constraint "b2b_spend_limit_membership_fk" foreign key ("membership_id") references "b2b_buyer_membership" ("id") on delete cascade
    );`)

    this.addSql(`create table if not exists "b2b_purchase_order_requirement" (
      "id" text not null,
      "organisation_id" text not null,
      "market_key" text null,
      "required" boolean not null default true,
      "format_pattern" text null,
      "description" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_purchase_order_requirement_pkey" primary key ("id"),
      constraint "b2b_purchase_order_requirement_organisation_fk" foreign key ("organisation_id") references "b2b_organisation" ("id") on delete cascade
    );`)

    this.addSql(`create table if not exists "b2b_credit_terms" (
      "id" text not null,
      "organisation_id" text not null,
      "market_key" text null,
      "currency_code" text not null,
      "payment_terms_code" text not null,
      "payment_due_days" integer not null,
      "projected_credit_limit_minor" numeric null,
      "raw_projected_credit_limit_minor" jsonb null,
      "authority" text check ("authority" in ('ERP','CONTRACT','MANUAL')) not null default 'ERP',
      "source_reference" text null,
      "effective_from" timestamptz null,
      "effective_until" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_credit_terms_pkey" primary key ("id"),
      constraint "b2b_credit_terms_organisation_fk" foreign key ("organisation_id") references "b2b_organisation" ("id") on delete cascade
    );`)

    this.addSql(`create table if not exists "b2b_commercial_terms" (
      "id" text not null,
      "organisation_id" text not null,
      "market_key" text not null,
      "agreement_reference" text not null,
      "status" text check ("status" in ('DRAFT','ACTIVE','EXPIRED','TERMINATED')) not null default 'DRAFT',
      "incoterm_code" text null,
      "effective_from" timestamptz null,
      "effective_until" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_commercial_terms_pkey" primary key ("id"),
      constraint "b2b_commercial_terms_organisation_fk" foreign key ("organisation_id") references "b2b_organisation" ("id") on delete cascade
    );`)

    this.addSql(`create table if not exists "b2b_tax_registration" (
      "id" text not null,
      "organisation_id" text not null,
      "market_key" text not null,
      "country_code" text not null,
      "registration_type" text check ("registration_type" in ('VAT','TIN','IMPORTER','EXPORTER','OTHER')) not null,
      "registration_number" text not null,
      "status" text check ("status" in ('PENDING','VERIFIED','REJECTED','EXPIRED')) not null default 'PENDING',
      "verified_at" timestamptz null,
      "expires_at" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_tax_registration_pkey" primary key ("id"),
      constraint "b2b_tax_registration_organisation_fk" foreign key ("organisation_id") references "b2b_organisation" ("id") on delete cascade
    );`)

    this.addSql(`create table if not exists "b2b_delivery_site" (
      "id" text not null,
      "organisation_id" text not null,
      "market_key" text not null,
      "code" text not null,
      "name" text not null,
      "status" text check ("status" in ('ACTIVE','SUSPENDED','CLOSED')) not null default 'ACTIVE',
      "address_1" text not null,
      "address_2" text null,
      "city" text not null,
      "province" text null,
      "postal_code" text null,
      "country_code" text not null,
      "contact_name" text null,
      "contact_phone" text null,
      "allow_shipping" boolean not null default true,
      "allow_billing" boolean not null default false,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_delivery_site_pkey" primary key ("id"),
      constraint "b2b_delivery_site_organisation_fk" foreign key ("organisation_id") references "b2b_organisation" ("id") on delete cascade
    );`)

    this.addSql(`create table if not exists "b2b_purchase_approval" (
      "id" text not null,
      "organisation_id" text not null,
      "requested_by_membership_id" text not null,
      "decided_by_membership_id" text null,
      "cart_id" text null,
      "order_id" text null,
      "status" text check ("status" in ('PENDING','APPROVED','REJECTED','CANCELLED')) not null default 'PENDING',
      "amount_minor" numeric not null,
      "raw_amount_minor" jsonb not null,
      "currency_code" text not null,
      "reason" text not null,
      "decision_note" text null,
      "decided_at" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_purchase_approval_pkey" primary key ("id"),
      constraint "b2b_purchase_approval_organisation_fk" foreign key ("organisation_id") references "b2b_organisation" ("id") on delete cascade,
      constraint "b2b_purchase_approval_requester_fk" foreign key ("requested_by_membership_id") references "b2b_buyer_membership" ("id"),
      constraint "b2b_purchase_approval_decider_fk" foreign key ("decided_by_membership_id") references "b2b_buyer_membership" ("id")
    );`)

    this.addSql(`create table if not exists "b2b_purchase_order_reference" (
      "id" text not null,
      "organisation_id" text not null,
      "submitted_by_membership_id" text not null,
      "customer_po_number" text not null,
      "cart_id" text null,
      "order_id" text null,
      "status" text check ("status" in ('DRAFT','COMMITTED','CANCELLED')) not null default 'DRAFT',
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_purchase_order_reference_pkey" primary key ("id"),
      constraint "b2b_purchase_order_reference_organisation_fk" foreign key ("organisation_id") references "b2b_organisation" ("id") on delete cascade,
      constraint "b2b_purchase_order_reference_membership_fk" foreign key ("submitted_by_membership_id") references "b2b_buyer_membership" ("id")
    );`)

    const indexes = [
      `create index if not exists "IDX_b2b_organisation_tenant" on "b2b_organisation" ("tenant_id") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_organisation_registration" on "b2b_organisation" ("tenant_id", "registration_number") where "deleted_at" is null and "registration_number" is not null`,
      `create unique index if not exists "IDX_b2b_membership_customer" on "b2b_buyer_membership" ("organisation_id", "customer_id") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_invitation_token" on "b2b_buyer_membership" ("invitation_token_hash") where "deleted_at" is null and "invitation_token_hash" is not null`,
      `create unique index if not exists "IDX_b2b_buyer_role" on "b2b_buyer_role" ("membership_id", "role") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_approval_policy" on "b2b_approval_policy" ("organisation_id", "market_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_spend_limit" on "b2b_spend_limit" ("membership_id", "market_key", "currency_code") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_po_requirement" on "b2b_purchase_order_requirement" ("organisation_id", "market_key") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_credit_terms" on "b2b_credit_terms" ("organisation_id", "market_key", "currency_code") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_delivery_site" on "b2b_delivery_site" ("organisation_id", "code") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_tax_registration" on "b2b_tax_registration" ("organisation_id", "market_key", "registration_type", "registration_number") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_po_number" on "b2b_purchase_order_reference" ("organisation_id", "customer_po_number") where "deleted_at" is null`,
      `create unique index if not exists "IDX_b2b_po_cart" on "b2b_purchase_order_reference" ("cart_id") where "deleted_at" is null and "cart_id" is not null`,
      `create unique index if not exists "IDX_b2b_po_order" on "b2b_purchase_order_reference" ("order_id") where "deleted_at" is null and "order_id" is not null`,
    ]
    for (const sql of indexes) this.addSql(`${sql};`)
  }

  async down(): Promise<void> {
    for (const table of [
      "b2b_purchase_order_reference",
      "b2b_purchase_approval",
      "b2b_delivery_site",
      "b2b_tax_registration",
      "b2b_commercial_terms",
      "b2b_credit_terms",
      "b2b_purchase_order_requirement",
      "b2b_spend_limit",
      "b2b_approval_policy",
      "b2b_buyer_role",
      "b2b_buyer_membership",
      "b2b_organisation",
    ]) {
      this.addSql(`drop table if exists "${table}" cascade;`)
    }
  }
}
