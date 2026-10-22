import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-042 section 14, Decision 5 / CAA-06: the spend reservation
 * commands (src/baobab/b2b/spend-reservation-commands.ts).
 *
 * - b2b_spend_reservation gains its full applicable amount, a stable
 *   purchase reference (the cart, draft order, RFQ or quotation across
 *   versions), the reservation it supersedes and a hold revision. The
 *   first three join the immutable purchase binding, so the guard is
 *   replaced to cover them; hold_revision only advances by one, on
 *   rollover, so approvals and buyer receipts bound to a former hold go
 *   stale. One ACTIVE reservation per purchase. No row exists yet (nothing
 *   wrote the ledger before these commands), so nothing is backfilled.
 * - b2b_spend_command: one row per applied command, keyed by its
 *   idempotency key, holding the request digest and the original result.
 *   A retry with the same request returns that result; the same key with
 *   another request is a conflict. Append-only.
 */
const raw = (column: string) => `jsonb_build_object('value', (${column})::text, 'precision', 20)`

/**
 * The reservation guard. With the purchase binding it also keeps the amount,
 * the stable purchase reference and the superseded reservation immutable,
 * and lets hold_revision only advance by one while ACTIVE (a rollover).
 * Without it, down() restores Migration20261022150000's guard.
 */
const reservationGuard = (bound: boolean) => {
  const columns = bound
    ? `, $."amount_minor", $."raw_amount_minor", $."purchase_reference", $."supersedes_reservation_id"`
    : ""
  return `create or replace function "b2b_spend_reservation_guard"() returns trigger
      language plpgsql as $$
      begin
        if tg_op = 'DELETE' then
          raise exception 'b2b_spend_reservation: reservations are released, never deleted';
        end if;
        if tg_op = 'INSERT' then
          if new."status" <> 'ACTIVE' then
            raise exception 'b2b_spend_reservation: a reservation starts ACTIVE';
          end if;
          ${
            bound
              ? `if new."amount_minor" is null or new."purchase_reference" is null then
            raise exception 'b2b_spend_reservation: a reservation carries its purchase and full applicable amount';
          end if;
          new."raw_amount_minor" := ${raw('new."amount_minor"')};
          new."hold_revision" := 1;`
              : ""
          }
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
            new."currency_code", new."agreement_reference", new."transaction_digest", new."resource_version",
            new."expires_at"${columns.replaceAll("$", "new")})
           is distinct from
           (old."tenant_id", old."organisation_id", old."membership_id", old."submitted_by_principal_id", old."market_key",
            old."currency_code", old."agreement_reference", old."transaction_digest", old."resource_version",
            old."expires_at"${columns.replaceAll("$", "old")}) then
          raise exception 'b2b_spend_reservation: a reservation is bound to one immutable purchase';
        end if;
        ${
          bound
            ? `if new."hold_revision" not in (old."hold_revision", old."hold_revision" + 1)
           or (new."hold_revision" <> old."hold_revision" and new."status" <> 'ACTIVE') then
          raise exception 'b2b_spend_reservation: hold_revision only advances by one on rollover';
        end if;`
            : ""
        }
        return new;
      end $$;`
}

export class Migration20261022180000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "b2b_spend_reservation"
      add column if not exists "amount_minor" numeric null,
      add column if not exists "raw_amount_minor" jsonb null,
      add column if not exists "purchase_reference" text null,
      add column if not exists "supersedes_reservation_id" text null,
      add column if not exists "hold_revision" integer not null default 1;`)
    this
      .addSql(`alter table "b2b_spend_reservation" add constraint "b2b_spend_reservation_supersedes_fk"
      foreign key ("supersedes_reservation_id") references "b2b_spend_reservation" ("id");`)
    this
      .addSql(`alter table "b2b_spend_reservation" add constraint "b2b_spend_reservation_purchase_check"
      check ("purchase_reference" is null or length(btrim("purchase_reference")) between 1 and 200);`)
    // One ACTIVE reservation per purchase: a new version supersedes, never coexists.
    this.addSql(`create unique index if not exists "IDX_b2b_spend_reservation_active_purchase"
      on "b2b_spend_reservation" ("organisation_id", "purchase_reference")
      where "status" = 'ACTIVE' and "deleted_at" is null;`)
    this
      .addSql(`alter table "b2b_spend_reservation" add constraint "b2b_spend_reservation_amount_check"
      check ("amount_minor" is null or ("amount_minor" > 0 and "amount_minor" = trunc("amount_minor")));`)
    this.addSql(reservationGuard(true))

    this.addSql(`create table if not exists "b2b_spend_command" (
      "id" text not null,
      "idempotency_key" text not null,
      "command_kind" text check ("command_kind" in ('SUBMIT','RESUBMIT','COMMIT','RELEASE','EXPIRE','ROLLOVER')) not null,
      "organisation_id" text not null,
      "request_digest" text not null,
      "reservation_id" text not null,
      "result" jsonb not null,
      "actor_principal_id" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "b2b_spend_command_pkey" primary key ("id"),
      constraint "b2b_spend_command_idempotency_unique" unique ("idempotency_key"),
      constraint "b2b_spend_command_reservation_fk" foreign key ("reservation_id") references "b2b_spend_reservation" ("id"),
      constraint "b2b_spend_command_idempotency_check" check ("idempotency_key" ~ '^[A-Za-z0-9._:-]{16,128}$'),
      constraint "b2b_spend_command_digest_check" check ("request_digest" ~ '^sha256:[0-9a-f]{64}$')
    );`)
    this.addSql(`create or replace function "b2b_spend_command_guard"() returns trigger
      language plpgsql as $$
      begin
        raise exception 'b2b_spend_command is append-only';
      end $$;`)
    this.addSql(`create trigger "b2b_spend_command_guard"
      before update or delete on "b2b_spend_command"
      for each row execute function "b2b_spend_command_guard"();`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "b2b_spend_command" cascade;`)
    this.addSql(`drop function if exists "b2b_spend_command_guard"();`)
    this.addSql(reservationGuard(false))
    this.addSql(
      `alter table "b2b_spend_reservation" drop constraint if exists "b2b_spend_reservation_amount_check";`,
    )
    this.addSql(`drop index if exists "IDX_b2b_spend_reservation_active_purchase";`)
    for (const constraint of ["supersedes_fk", "purchase_check"]) {
      this.addSql(
        `alter table "b2b_spend_reservation" drop constraint if exists "b2b_spend_reservation_${constraint}";`,
      )
    }
    this.addSql(`alter table "b2b_spend_reservation" drop column if exists "raw_amount_minor",
      drop column if exists "amount_minor", drop column if exists "purchase_reference",
      drop column if exists "supersedes_reservation_id", drop column if exists "hold_revision";`)
  }
}
