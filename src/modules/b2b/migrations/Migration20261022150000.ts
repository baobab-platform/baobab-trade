import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-042 section 14, Decision 5 (Platform Owner, 2026-10-22):
 * cumulative buyer spending authority (Shared trade/v2
 * buyer-spend-budget.schema.json; Trade ADR-0033).
 *
 * The database is the concurrency authority for the spending-control ledger:
 *
 * - b2b_spend_budget_policy: versioned budgets. MEMBERSHIP (mandatory,
 *   calendar month), AGREEMENT (the agreement's term) and ORGANISATION
 *   (calendar month, shared). The database owns the revision; RETIRED is
 *   terminal; one ACTIVE policy per scope, Market and currency.
 * - b2b_spend_reservation: one formally submitted, immutable purchase. Its
 *   binding never changes and COMMITTED / RELEASED / EXPIRED are terminal.
 * - b2b_spend_ledger_entry: append-only RESERVE / COMMIT / RELEASE. Each
 *   insert locks its policy's period balance row, checks capacity and moves
 *   the balance and the per-reservation hold in the same transaction. The
 *   database stamps occurred_at and derives the period, so nothing is
 *   backdated into another month.
 * - b2b_spend_budget_balance and b2b_spend_reservation_hold: written only by
 *   the ledger trigger (a transaction-local guard refuses every other write).
 *
 * COMMIT converts reserved into committed and never adds consumption, so an
 * approved purchase is never counted twice. Only a hold's unused portion is
 * released. No budget is allocated here: existing members need governed
 * allocation, and no limit is derived from order_limit_minor.
 *
 * Commands that touch several policies (member, organisation, agreement) in
 * one transaction must insert their entries in budget_policy_id order so row
 * locks are always taken in the same order (CAA-06).
 */
const raw = (column: string) => `jsonb_build_object('value', (${column})::text, 'precision', 20)`

export class Migration20261022150000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "b2b_spend_budget_policy" (
      "id" text not null,
      "revision" integer not null default 1,
      "status" text check ("status" in ('ACTIVE','SUSPENDED','RETIRED')) not null default 'ACTIVE',
      "scope" text check ("scope" in ('MEMBERSHIP','AGREEMENT','ORGANISATION')) not null,
      "tenant_id" text not null,
      "organisation_id" text not null,
      "membership_id" text null,
      "agreement_reference" text null,
      "market_key" text not null,
      "currency_code" text not null,
      "period_kind" text check ("period_kind" in ('CALENDAR_MONTH','AGREEMENT_TERM')) not null,
      "timezone" text not null default 'UTC',
      "limit_minor" numeric not null,
      "raw_limit_minor" jsonb not null,
      "effective_from" timestamptz not null,
      "effective_until" timestamptz null,
      "evidence_reference" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_spend_budget_policy_pkey" primary key ("id"),
      constraint "b2b_spend_budget_policy_organisation_fk" foreign key ("organisation_id") references "b2b_organisation" ("id"),
      constraint "b2b_spend_budget_policy_membership_fk" foreign key ("membership_id") references "b2b_buyer_membership" ("id"),
      constraint "b2b_spend_budget_policy_limit_check" check ("limit_minor" > 0 and "limit_minor" = trunc("limit_minor")),
      constraint "b2b_spend_budget_policy_currency_check" check ("currency_code" ~ '^[A-Z]{3}$'),
      constraint "b2b_spend_budget_policy_interval_check" check ("effective_until" is null or "effective_until" > "effective_from"),
      constraint "b2b_spend_budget_policy_evidence_check" check (length(btrim("evidence_reference")) between 1 and 500),
      constraint "b2b_spend_budget_policy_binding_check" check (
        ("scope" = 'MEMBERSHIP' and "membership_id" is not null and "agreement_reference" is null and "period_kind" = 'CALENDAR_MONTH')
        or ("scope" = 'ORGANISATION' and "membership_id" is null and "agreement_reference" is null and "period_kind" = 'CALENDAR_MONTH')
        or ("scope" = 'AGREEMENT' and "membership_id" is null and "agreement_reference" is not null
            and "period_kind" = 'AGREEMENT_TERM' and "effective_until" is not null))
    );`)
    this
      .addSql(`create unique index if not exists "IDX_b2b_spend_budget_policy_active" on "b2b_spend_budget_policy"
      ("scope", "organisation_id", coalesce("membership_id", ''), coalesce("agreement_reference", ''), "market_key", "currency_code")
      where "status" = 'ACTIVE' and "deleted_at" is null;`)
    this.addSql(`create or replace function "b2b_spend_budget_policy_guard"() returns trigger
      language plpgsql as $$
      begin
        if tg_op = 'DELETE' then
          raise exception 'b2b_spend_budget_policy: policies are retired, never deleted';
        end if;
        if not exists (select 1 from pg_timezone_names where name = new."timezone") then
          raise exception 'b2b_spend_budget_policy: unknown time zone';
        end if;
        new."raw_limit_minor" := ${raw('new."limit_minor"')};
        if tg_op = 'INSERT' then
          new."revision" := 1;
          return new;
        end if;
        if old."status" = 'RETIRED' then
          raise exception 'b2b_spend_budget_policy: a RETIRED policy is terminal';
        end if;
        if (new."scope", new."tenant_id", new."organisation_id", new."membership_id", new."agreement_reference",
            new."market_key", new."currency_code", new."period_kind")
           is distinct from
           (old."scope", old."tenant_id", old."organisation_id", old."membership_id", old."agreement_reference",
            old."market_key", old."currency_code", old."period_kind") then
          raise exception 'b2b_spend_budget_policy: scope, Market, currency and period are immutable';
        end if;
        if (new."status", new."timezone", new."limit_minor", new."effective_from", new."effective_until", new."deleted_at")
           is distinct from
           (old."status", old."timezone", old."limit_minor", old."effective_from", old."effective_until", old."deleted_at") then
          new."revision" := old."revision" + 1;
        else
          new."revision" := old."revision";
        end if;
        return new;
      end $$;`)
    this.addSql(`create trigger "b2b_spend_budget_policy_guard"
      before insert or update or delete on "b2b_spend_budget_policy"
      for each row execute function "b2b_spend_budget_policy_guard"();`)

    this.addSql(`create table if not exists "b2b_spend_reservation" (
      "id" text not null,
      "tenant_id" text not null,
      "organisation_id" text not null,
      "membership_id" text not null,
      "submitted_by_principal_id" text not null,
      "market_key" text not null,
      "currency_code" text not null,
      "agreement_reference" text null,
      "transaction_digest" text not null,
      "resource_version" integer not null,
      "status" text check ("status" in ('ACTIVE','COMMITTED','RELEASED','EXPIRED')) not null default 'ACTIVE',
      "expires_at" timestamptz not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_spend_reservation_pkey" primary key ("id"),
      constraint "b2b_spend_reservation_membership_fk" foreign key ("membership_id") references "b2b_buyer_membership" ("id"),
      constraint "b2b_spend_reservation_digest_check" check ("transaction_digest" ~ '^sha256:[0-9a-f]{64}$'),
      constraint "b2b_spend_reservation_version_check" check ("resource_version" >= 1),
      constraint "b2b_spend_reservation_expiry_check" check ("expires_at" > "created_at")
    );`)
    this
      .addSql(`create unique index if not exists "IDX_b2b_spend_reservation_purchase" on "b2b_spend_reservation"
      ("membership_id", "transaction_digest", "resource_version") where "status" = 'ACTIVE' and "deleted_at" is null;`)
    this.addSql(`create or replace function "b2b_spend_reservation_guard"() returns trigger
      language plpgsql as $$
      begin
        if tg_op = 'DELETE' then
          raise exception 'b2b_spend_reservation: reservations are released, never deleted';
        end if;
        if tg_op = 'INSERT' then
          if new."status" <> 'ACTIVE' then
            raise exception 'b2b_spend_reservation: a reservation starts ACTIVE';
          end if;
          if not exists (select 1 from "b2b_buyer_membership" m
                          where m."id" = new."membership_id" and m."organisation_id" = new."organisation_id") then
            raise exception 'b2b_spend_reservation: the membership belongs to another Organisation';
          end if;
          return new;
        end if;
        if old."status" <> 'ACTIVE' then
          raise exception 'b2b_spend_reservation: % is terminal', old."status";
        end if;
        if (new."tenant_id", new."organisation_id", new."membership_id", new."submitted_by_principal_id", new."market_key",
            new."currency_code", new."agreement_reference", new."transaction_digest", new."resource_version", new."expires_at")
           is distinct from
           (old."tenant_id", old."organisation_id", old."membership_id", old."submitted_by_principal_id", old."market_key",
            old."currency_code", old."agreement_reference", old."transaction_digest", old."resource_version", old."expires_at") then
          raise exception 'b2b_spend_reservation: a reservation is bound to one immutable purchase';
        end if;
        return new;
      end $$;`)
    this.addSql(`create trigger "b2b_spend_reservation_guard"
      before insert or update or delete on "b2b_spend_reservation"
      for each row execute function "b2b_spend_reservation_guard"();`)

    this.addSql(`create table if not exists "b2b_spend_budget_balance" (
      "id" text not null,
      "budget_policy_id" text not null,
      "period_starts_at" timestamptz not null,
      "period_ends_at" timestamptz not null,
      "committed_minor" numeric not null default 0,
      "raw_committed_minor" jsonb not null default '{"value":"0","precision":20}',
      "reserved_minor" numeric not null default 0,
      "raw_reserved_minor" jsonb not null default '{"value":"0","precision":20}',
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_spend_budget_balance_pkey" primary key ("id"),
      constraint "b2b_spend_budget_balance_policy_fk" foreign key ("budget_policy_id") references "b2b_spend_budget_policy" ("id"),
      constraint "b2b_spend_budget_balance_period_unique" unique ("budget_policy_id", "period_starts_at"),
      constraint "b2b_spend_budget_balance_amounts_check" check ("committed_minor" >= 0 and "reserved_minor" >= 0),
      constraint "b2b_spend_budget_balance_period_check" check ("period_ends_at" > "period_starts_at")
    );`)
    this.addSql(`create table if not exists "b2b_spend_reservation_hold" (
      "id" text not null,
      "reservation_id" text not null,
      "budget_policy_id" text not null,
      "policy_revision" integer not null,
      "period_starts_at" timestamptz not null,
      "reserved_minor" numeric not null default 0,
      "raw_reserved_minor" jsonb not null default '{"value":"0","precision":20}',
      "committed_minor" numeric not null default 0,
      "raw_committed_minor" jsonb not null default '{"value":"0","precision":20}',
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_spend_reservation_hold_pkey" primary key ("id"),
      constraint "b2b_spend_reservation_hold_reservation_fk" foreign key ("reservation_id") references "b2b_spend_reservation" ("id"),
      constraint "b2b_spend_reservation_hold_policy_fk" foreign key ("budget_policy_id") references "b2b_spend_budget_policy" ("id"),
      constraint "b2b_spend_reservation_hold_unique" unique ("reservation_id", "budget_policy_id", "period_starts_at"),
      constraint "b2b_spend_reservation_hold_amounts_check" check ("committed_minor" >= 0 and "reserved_minor" >= 0)
    );`)
    for (const table of ["b2b_spend_budget_balance", "b2b_spend_reservation_hold"]) {
      this.addSql(`create or replace function "${table}_guard"() returns trigger
        language plpgsql as $$
        begin
          if coalesce(current_setting('baobab.spend_ledger_apply', true), '') <> 'on' then
            raise exception '${table} moves only through b2b_spend_ledger_entry';
          end if;
          if tg_op = 'DELETE' then
            raise exception '${table} rows are never deleted';
          end if;
          return new;
        end $$;`)
      this.addSql(`create trigger "${table}_guard"
        before insert or update or delete on "${table}"
        for each row execute function "${table}_guard"();`)
    }

    this.addSql(`create table if not exists "b2b_spend_ledger_entry" (
      "id" text not null,
      "entry_kind" text check ("entry_kind" in ('RESERVE','COMMIT','RELEASE')) not null,
      "reservation_id" text not null,
      "budget_policy_id" text not null,
      "policy_revision" integer not null,
      "period_starts_at" timestamptz null,
      "period_ends_at" timestamptz null,
      "amount_minor" numeric not null,
      "raw_amount_minor" jsonb not null,
      "commitment_reference" text null,
      "release_reason" text null check ("release_reason" is null or "release_reason" in
        ('REJECTED','CANCELLED','EXPIRED','AMOUNT_REDUCED','PERIOD_ROLLOVER','POLICY_REVISED')),
      "idempotency_key" text not null,
      "actor_principal_id" text not null,
      "occurred_at" timestamptz not null default now(),
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_spend_ledger_entry_pkey" primary key ("id"),
      constraint "b2b_spend_ledger_entry_reservation_fk" foreign key ("reservation_id") references "b2b_spend_reservation" ("id"),
      constraint "b2b_spend_ledger_entry_policy_fk" foreign key ("budget_policy_id") references "b2b_spend_budget_policy" ("id"),
      constraint "b2b_spend_ledger_entry_idempotency_unique" unique ("idempotency_key"),
      constraint "b2b_spend_ledger_entry_idempotency_check" check ("idempotency_key" ~ '^[A-Za-z0-9._:-]{16,128}$'),
      constraint "b2b_spend_ledger_entry_amount_check" check ("amount_minor" > 0 and "amount_minor" = trunc("amount_minor")),
      constraint "b2b_spend_ledger_entry_kind_check" check (
        ("entry_kind" = 'COMMIT') = ("commitment_reference" is not null)
        and ("entry_kind" = 'RELEASE') = ("release_reason" is not null))
    );`)
    this.addSql(`create or replace function "b2b_spend_ledger_entry_apply"() returns trigger
      language plpgsql as $$
      declare
        policy "b2b_spend_budget_policy"%rowtype;
        reservation "b2b_spend_reservation"%rowtype;
        balance "b2b_spend_budget_balance"%rowtype;
        hold "b2b_spend_reservation_hold"%rowtype;
        local_now timestamp;
      begin
        if tg_op <> 'INSERT' then
          raise exception 'b2b_spend_ledger_entry is append-only';
        end if;
        new."occurred_at" := now();
        new."raw_amount_minor" := ${raw('new."amount_minor"')};
        select * into policy from "b2b_spend_budget_policy" where "id" = new."budget_policy_id" for share;
        select * into reservation from "b2b_spend_reservation" where "id" = new."reservation_id" for share;
        if policy."id" is null or reservation."id" is null then
          raise exception 'b2b_spend_ledger_entry: unknown policy or reservation';
        end if;
        -- The reservation and the policy describe the same purchase scope.
        if (policy."tenant_id", policy."organisation_id", policy."market_key", policy."currency_code")
           is distinct from (reservation."tenant_id", reservation."organisation_id", reservation."market_key", reservation."currency_code")
           or (policy."scope" = 'MEMBERSHIP' and policy."membership_id" <> reservation."membership_id")
           or (policy."scope" = 'AGREEMENT' and policy."agreement_reference" is distinct from reservation."agreement_reference") then
          raise exception 'b2b_spend_ledger_entry: the reservation is outside this budget';
        end if;
        -- The period is derived from the database clock, never supplied, except
        -- that a RELEASE may name an existing earlier hold (month rollover or
        -- expiry): a release only ever returns capacity.
        if new."entry_kind" = 'RELEASE' and new."period_starts_at" is not null then
          select * into hold from "b2b_spend_reservation_hold"
            where "reservation_id" = new."reservation_id" and "budget_policy_id" = new."budget_policy_id"
              and "period_starts_at" = new."period_starts_at" for update;
          select * into balance from "b2b_spend_budget_balance"
            where "budget_policy_id" = new."budget_policy_id" and "period_starts_at" = new."period_starts_at" for update;
          if hold."id" is null or balance."id" is null then
            raise exception 'b2b_spend_ledger_entry: no hold to release in that period';
          end if;
          new."period_ends_at" := balance."period_ends_at";
          if new."amount_minor" > hold."reserved_minor" then
            raise exception 'b2b_spend_ledger_entry: RELEASE returns only the unused reserved portion';
          end if;
          perform set_config('baobab.spend_ledger_apply', 'on', true);
          update "b2b_spend_budget_balance" set "reserved_minor" = "reserved_minor" - new."amount_minor",
            "raw_reserved_minor" = ${raw('"reserved_minor" - new."amount_minor"')}, "updated_at" = now() where "id" = balance."id";
          update "b2b_spend_reservation_hold" set "reserved_minor" = "reserved_minor" - new."amount_minor",
            "raw_reserved_minor" = ${raw('"reserved_minor" - new."amount_minor"')}, "updated_at" = now() where "id" = hold."id";
          perform set_config('baobab.spend_ledger_apply', '', true);
          return new;
        end if;
        if policy."period_kind" = 'CALENDAR_MONTH' then
          local_now := now() at time zone policy."timezone";
          new."period_starts_at" := date_trunc('month', local_now) at time zone policy."timezone";
          new."period_ends_at" := (date_trunc('month', local_now) + interval '1 month') at time zone policy."timezone";
        else
          new."period_starts_at" := policy."effective_from";
          new."period_ends_at" := policy."effective_until";
        end if;
        if now() < new."period_starts_at" or now() >= new."period_ends_at" then
          raise exception 'b2b_spend_ledger_entry: outside the budget period';
        end if;

        perform set_config('baobab.spend_ledger_apply', 'on', true);
        insert into "b2b_spend_budget_balance" ("id", "budget_policy_id", "period_starts_at", "period_ends_at")
          values ('b2bbal_' || md5(new."budget_policy_id" || new."period_starts_at"::text), new."budget_policy_id",
                  new."period_starts_at", new."period_ends_at")
          on conflict ("budget_policy_id", "period_starts_at") do nothing;
        select * into balance from "b2b_spend_budget_balance"
          where "budget_policy_id" = new."budget_policy_id" and "period_starts_at" = new."period_starts_at" for update;
        insert into "b2b_spend_reservation_hold" ("id", "reservation_id", "budget_policy_id", "policy_revision", "period_starts_at")
          values ('b2bhold_' || md5(new."reservation_id" || new."budget_policy_id" || new."period_starts_at"::text),
                  new."reservation_id", new."budget_policy_id", policy."revision", new."period_starts_at")
          on conflict ("reservation_id", "budget_policy_id", "period_starts_at") do nothing;
        select * into hold from "b2b_spend_reservation_hold"
          where "reservation_id" = new."reservation_id" and "budget_policy_id" = new."budget_policy_id"
            and "period_starts_at" = new."period_starts_at" for update;

        if new."entry_kind" = 'RESERVE' then
          if reservation."status" <> 'ACTIVE' or now() >= reservation."expires_at" then
            raise exception 'b2b_spend_ledger_entry: the reservation is not active';
          end if;
          -- A fully released hold may be re-reserved under a revised policy.
          if hold."reserved_minor" = 0 and hold."committed_minor" = 0 and hold."policy_revision" <> policy."revision" then
            update "b2b_spend_reservation_hold" set "policy_revision" = policy."revision", "updated_at" = now() where "id" = hold."id";
            hold."policy_revision" := policy."revision";
          end if;
          if policy."status" <> 'ACTIVE' or now() < policy."effective_from"
             or (policy."effective_until" is not null and now() >= policy."effective_until")
             or new."policy_revision" <> policy."revision" or hold."policy_revision" <> policy."revision" then
            raise exception 'b2b_spend_ledger_entry: the budget is not in effect at this revision';
          end if;
          if new."amount_minor" > policy."limit_minor" - balance."committed_minor" - balance."reserved_minor" then
            raise exception 'b2b_spend_ledger_entry: insufficient budget capacity' using errcode = 'check_violation';
          end if;
          update "b2b_spend_budget_balance" set "reserved_minor" = "reserved_minor" + new."amount_minor",
            "raw_reserved_minor" = ${raw('"reserved_minor" + new."amount_minor"')}, "updated_at" = now() where "id" = balance."id";
          update "b2b_spend_reservation_hold" set "reserved_minor" = "reserved_minor" + new."amount_minor",
            "raw_reserved_minor" = ${raw('"reserved_minor" + new."amount_minor"')}, "updated_at" = now() where "id" = hold."id";
        elsif new."entry_kind" = 'COMMIT' then
          if reservation."status" <> 'ACTIVE' or now() >= reservation."expires_at" then
            raise exception 'b2b_spend_ledger_entry: an expired or closed reservation never authorises commitment';
          end if;
          if policy."status" <> 'ACTIVE' or new."policy_revision" <> policy."revision"
             or hold."policy_revision" <> policy."revision" then
            raise exception 'b2b_spend_ledger_entry: the budget changed; the reservation must be revalidated';
          end if;
          if new."amount_minor" > hold."reserved_minor" then
            raise exception 'b2b_spend_ledger_entry: COMMIT converts only this period''s reserved capacity';
          end if;
          update "b2b_spend_budget_balance" set "reserved_minor" = "reserved_minor" - new."amount_minor",
            "raw_reserved_minor" = ${raw('"reserved_minor" - new."amount_minor"')},
            "committed_minor" = "committed_minor" + new."amount_minor",
            "raw_committed_minor" = ${raw('"committed_minor" + new."amount_minor"')}, "updated_at" = now() where "id" = balance."id";
          update "b2b_spend_reservation_hold" set "reserved_minor" = "reserved_minor" - new."amount_minor",
            "raw_reserved_minor" = ${raw('"reserved_minor" - new."amount_minor"')},
            "committed_minor" = "committed_minor" + new."amount_minor",
            "raw_committed_minor" = ${raw('"committed_minor" + new."amount_minor"')}, "updated_at" = now() where "id" = hold."id";
        else
          if new."amount_minor" > hold."reserved_minor" then
            raise exception 'b2b_spend_ledger_entry: RELEASE returns only the unused reserved portion';
          end if;
          update "b2b_spend_budget_balance" set "reserved_minor" = "reserved_minor" - new."amount_minor",
            "raw_reserved_minor" = ${raw('"reserved_minor" - new."amount_minor"')}, "updated_at" = now() where "id" = balance."id";
          update "b2b_spend_reservation_hold" set "reserved_minor" = "reserved_minor" - new."amount_minor",
            "raw_reserved_minor" = ${raw('"reserved_minor" - new."amount_minor"')}, "updated_at" = now() where "id" = hold."id";
        end if;
        perform set_config('baobab.spend_ledger_apply', '', true);
        return new;
      end $$;`)
    this.addSql(`create trigger "b2b_spend_ledger_entry_apply"
      before insert or update or delete on "b2b_spend_ledger_entry"
      for each row execute function "b2b_spend_ledger_entry_apply"();`)
  }

  async down(): Promise<void> {
    for (const table of [
      "b2b_spend_ledger_entry",
      "b2b_spend_reservation_hold",
      "b2b_spend_budget_balance",
      "b2b_spend_reservation",
      "b2b_spend_budget_policy",
    ]) {
      this.addSql(`drop table if exists "${table}" cascade;`)
    }
    for (const fn of [
      "b2b_spend_ledger_entry_apply",
      "b2b_spend_reservation_hold_guard",
      "b2b_spend_budget_balance_guard",
      "b2b_spend_reservation_guard",
      "b2b_spend_budget_policy_guard",
    ]) {
      this.addSql(`drop function if exists "${fn}"();`)
    }
  }
}
