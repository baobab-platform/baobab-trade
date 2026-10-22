import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-042 section 14, CAA-05 ruling of 2026-10-22 (Trade ADR-0033):
 * role-bound Market and Site grants, and the binding facts of a purchase
 * approval.
 *
 * A grant belongs to one role assignment, never to the membership as a whole,
 * so permissions cannot be composed across roles. An absent grant is never
 * "all Markets" or "all Sites". The database owns each grant's revision, a
 * REVOKED grant is terminal, a Site grant can only name a Site of the role's
 * own buyer Organisation, and every grant change advances the membership
 * revision so any derived buyer context evaluated before it is stale. No
 * existing membership receives a grant here: legacy access stays unavailable
 * for protected transactions until a governed workflow records it.
 */
const SCOPES = [
  {
    table: "b2b_buyer_role_market_scope",
    key: '"market_key" text not null',
    unique: '"market_key"',
  },
  {
    table: "b2b_buyer_role_site_scope",
    key: `"delivery_site_id" text not null,
      constraint "b2b_buyer_role_site_scope_site_fk" foreign key ("delivery_site_id") references "b2b_delivery_site" ("id")`,
    unique: '"delivery_site_id"',
  },
] as const

export class Migration20261022120000 extends Migration {
  async up(): Promise<void> {
    for (const scope of SCOPES) {
      this.addSql(`create table if not exists "${scope.table}" (
        "id" text not null,
        "buyer_role_id" text not null,
        ${scope.key},
        "status" text check ("status" in ('ACTIVE','SUSPENDED','REVOKED')) not null default 'ACTIVE',
        "effective_from" timestamptz null,
        "effective_until" timestamptz null,
        "revision" integer not null default 1,
        "granted_by_principal_id" text not null,
        "evidence_reference" text not null,
        "revoked_at" timestamptz null,
        "revoked_by_principal_id" text null,
        "revocation_reason" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "${scope.table}_pkey" primary key ("id"),
        constraint "${scope.table}_role_fk" foreign key ("buyer_role_id") references "b2b_buyer_role" ("id"),
        constraint "${scope.table}_revision_check" check ("revision" >= 1),
        constraint "${scope.table}_interval_check"
          check ("effective_until" is null or "effective_from" is null or "effective_until" > "effective_from"),
        constraint "${scope.table}_provenance_check"
          check (length(btrim("granted_by_principal_id")) > 0 and length(btrim("evidence_reference")) between 1 and 500),
        constraint "${scope.table}_revocation_check" check (
          ("status" = 'REVOKED') = ("revoked_at" is not null and "revoked_by_principal_id" is not null))
      );`)
      this.addSql(
        `create unique index if not exists "IDX_${scope.table}_grant" on "${scope.table}" ("buyer_role_id", ${scope.unique}) where "deleted_at" is null;`,
      )

      this.addSql(`create or replace function "${scope.table}_guard"() returns trigger
        language plpgsql as $$
        begin
          if tg_op = 'DELETE' then
            raise exception '${scope.table} grants are revoked, never deleted';
          end if;
          if tg_op = 'UPDATE' then
            if old."status" = 'REVOKED' then
              raise exception '${scope.table}: a REVOKED grant is terminal';
            end if;
            if (new."buyer_role_id", new.${scope.unique}) is distinct from (old."buyer_role_id", old.${scope.unique}) then
              raise exception '${scope.table}: a grant cannot be moved to another role or scope';
            end if;
            new."revision" := old."revision" + 1;
          else
            new."revision" := 1;
          end if;
          return new;
        end $$;`)
      this.addSql(`create trigger "${scope.table}_guard"
        before insert or update or delete on "${scope.table}"
        for each row execute function "${scope.table}_guard"();`)

      // Any grant change is a membership change: derived contexts name the
      // membership revision they evaluated.
      this.addSql(`create or replace function "${scope.table}_membership_revision"() returns trigger
        language plpgsql as $$
        begin
          update "b2b_buyer_membership" set "revision" = "revision" + 1
           where "id" = (select "membership_id" from "b2b_buyer_role" where "id" = new."buyer_role_id");
          return null;
        end $$;`)
      this.addSql(`create trigger "${scope.table}_membership_revision"
        after insert or update on "${scope.table}"
        for each row execute function "${scope.table}_membership_revision"();`)
    }

    // A Site grant can only name a Site of the role's own buyer Organisation;
    // a foreign Site is never grantable.
    this
      .addSql(`create or replace function "b2b_buyer_role_site_scope_organisation"() returns trigger
      language plpgsql as $$
      begin
        if not exists (
          select 1 from "b2b_buyer_role" r
            join "b2b_buyer_membership" m on m."id" = r."membership_id"
            join "b2b_delivery_site" s on s."organisation_id" = m."organisation_id"
           where r."id" = new."buyer_role_id" and s."id" = new."delivery_site_id") then
          raise exception 'b2b_buyer_role_site_scope: the Site belongs to another Organisation';
        end if;
        return new;
      end $$;`)
    this.addSql(`create trigger "b2b_buyer_role_site_scope_organisation"
      before insert on "b2b_buyer_role_site_scope"
      for each row execute function "b2b_buyer_role_site_scope_organisation"();`)

    // ADR-SHARED-042 section 8: an approval binds the initiating and approving
    // canonical Principals, the Market, the exact transaction version and
    // digest and the policy revision. Legacy rows have none and are never
    // usable for a protected commitment.
    this.addSql(`alter table "b2b_purchase_approval"
      add column if not exists "requested_by_principal_id" text null,
      add column if not exists "decided_by_principal_id" text null,
      add column if not exists "market_key" text null,
      add column if not exists "transaction_digest" text null,
      add column if not exists "resource_version" text null,
      add column if not exists "policy_revision" text null,
      add constraint "b2b_purchase_approval_digest_check"
        check ("transaction_digest" is null or "transaction_digest" ~ '^sha256:[0-9a-f]{64}$'),
      add constraint "b2b_purchase_approval_distinct_approver_check"
        check ("decided_by_principal_id" is null or "decided_by_principal_id" <> "requested_by_principal_id");`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table "b2b_purchase_approval"
      drop constraint if exists "b2b_purchase_approval_distinct_approver_check",
      drop constraint if exists "b2b_purchase_approval_digest_check",
      drop column if exists "policy_revision",
      drop column if exists "resource_version",
      drop column if exists "transaction_digest",
      drop column if exists "market_key",
      drop column if exists "decided_by_principal_id",
      drop column if exists "requested_by_principal_id";`)
    this.addSql(
      'drop trigger if exists "b2b_buyer_role_site_scope_organisation" on "b2b_buyer_role_site_scope";',
    )
    this.addSql('drop function if exists "b2b_buyer_role_site_scope_organisation"();')
    for (const scope of [...SCOPES].reverse()) {
      this.addSql(`drop table if exists "${scope.table}" cascade;`)
      this.addSql(`drop function if exists "${scope.table}_membership_revision"();`)
      this.addSql(`drop function if exists "${scope.table}_guard"();`)
    }
  }
}
