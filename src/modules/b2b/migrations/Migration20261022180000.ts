import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-042 section 14, Decision 5 / CAA-06: the spend reservation
 * commands (src/baobab/b2b/spend-reservation-commands.ts).
 *
 * - b2b_spend_reservation gains its full applicable amount. It is part of
 *   the immutable purchase binding, so the guard is replaced to cover it,
 *   and every new reservation must carry it. No row exists yet (nothing
 *   wrote the ledger before these commands), so nothing is backfilled.
 * - b2b_spend_command: one row per applied command, keyed by its
 *   idempotency key, holding the request digest and the original result.
 *   A retry with the same request returns that result; the same key with
 *   another request is a conflict. Append-only.
 */
const raw = (column: string) => `jsonb_build_object('value', (${column})::text, 'precision', 20)`

/** The reservation guard, with or without the amount (down() restores Migration20261022150000's). */
const reservationGuard = (withAmount: boolean) => {
  const amount = withAmount ? `, new."amount_minor", new."raw_amount_minor"` : ""
  const oldAmount = withAmount ? `, old."amount_minor", old."raw_amount_minor"` : ""
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
            withAmount
              ? `if new."amount_minor" is null then
            raise exception 'b2b_spend_reservation: a reservation carries its full applicable amount';
          end if;
          new."raw_amount_minor" := ${raw('new."amount_minor"')};`
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
            new."currency_code", new."agreement_reference", new."transaction_digest", new."resource_version", new."expires_at"${amount})
           is distinct from
           (old."tenant_id", old."organisation_id", old."membership_id", old."submitted_by_principal_id", old."market_key",
            old."currency_code", old."agreement_reference", old."transaction_digest", old."resource_version", old."expires_at"${oldAmount}) then
          raise exception 'b2b_spend_reservation: a reservation is bound to one immutable purchase';
        end if;
        return new;
      end $$;`
}

export class Migration20261022180000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "b2b_spend_reservation"
      add column if not exists "amount_minor" numeric null,
      add column if not exists "raw_amount_minor" jsonb null;`)
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
    this.addSql(
      `alter table "b2b_spend_reservation" drop column if exists "raw_amount_minor", drop column if exists "amount_minor";`,
    )
  }
}
