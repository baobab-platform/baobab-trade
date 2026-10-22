import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-042 sections 5-6 (CAA-04/05; ADR-0033): the Trade buyer
 * relationship records the Trade engine instance it belongs to, a monotonic
 * relationship revision and the provenance of its canonical Organisation
 * link, and every membership carries a monotonic revision. The database owns
 * both revisions: an authority-relevant change always increments them, and
 * application code can never set them backwards or skip ahead. A role change
 * is a membership change. A derived buyer context names the revisions it
 * evaluated, so any later change invalidates it.
 */
export class Migration20261022090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "b2b_organisation"
      add column if not exists "engine_instance_id" text null,
      add column if not exists "relationship_revision" integer not null default 1,
      add column if not exists "link_provenance" text null,
      add constraint "b2b_organisation_engine_instance_check"
        check ("engine_instance_id" is null or "engine_instance_id" ~ '^ei_[a-z0-9]+$'),
      add constraint "b2b_organisation_relationship_revision_check" check ("relationship_revision" >= 1),
      add constraint "b2b_organisation_link_provenance_check"
        check ("link_provenance" is null or length(btrim("link_provenance")) between 1 and 500);`)
    this.addSql(`alter table "b2b_buyer_membership"
      add column if not exists "revision" integer not null default 1,
      add constraint "b2b_buyer_membership_revision_check" check ("revision" >= 1);`)

    this
      .addSql(`create or replace function "b2b_organisation_relationship_revision"() returns trigger
      language plpgsql as $$
      begin
        if (new."status", new."tenant_id", new."canonical_organisation_id", new."engine_instance_id",
            new."link_provenance", new."deleted_at")
           is distinct from
           (old."status", old."tenant_id", old."canonical_organisation_id", old."engine_instance_id",
            old."link_provenance", old."deleted_at") then
          new."relationship_revision" := old."relationship_revision" + 1;
        else
          new."relationship_revision" := old."relationship_revision";
        end if;
        return new;
      end $$;`)
    this.addSql(`create trigger "b2b_organisation_relationship_revision"
      before update on "b2b_organisation"
      for each row execute function "b2b_organisation_relationship_revision"();`)

    // An authority-relevant change increments the revision; a role change
    // arrives as an explicit +1 from the role trigger; anything else keeps it.
    this.addSql(`create or replace function "b2b_buyer_membership_revision"() returns trigger
      language plpgsql as $$
      begin
        if (new."status", new."principal_id", new."organisation_id", new."customer_id",
            new."effective_from", new."effective_until", new."deleted_at")
           is distinct from
           (old."status", old."principal_id", old."organisation_id", old."customer_id",
            old."effective_from", old."effective_until", old."deleted_at") then
          new."revision" := old."revision" + 1;
        elsif new."revision" <> old."revision" + 1 then
          new."revision" := old."revision";
        end if;
        return new;
      end $$;`)
    this.addSql(`create trigger "b2b_buyer_membership_revision"
      before update on "b2b_buyer_membership"
      for each row execute function "b2b_buyer_membership_revision"();`)

    this.addSql(`create or replace function "b2b_buyer_role_membership_revision"() returns trigger
      language plpgsql as $$
      begin
        if tg_op in ('UPDATE', 'DELETE') then
          update "b2b_buyer_membership" set "revision" = "revision" + 1 where "id" = old."membership_id";
        end if;
        if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new."membership_id" is distinct from old."membership_id") then
          update "b2b_buyer_membership" set "revision" = "revision" + 1 where "id" = new."membership_id";
        end if;
        return null;
      end $$;`)
    this.addSql(`create trigger "b2b_buyer_role_membership_revision"
      after insert or update or delete on "b2b_buyer_role"
      for each row execute function "b2b_buyer_role_membership_revision"();`)
  }

  async down(): Promise<void> {
    this.addSql('drop trigger if exists "b2b_buyer_role_membership_revision" on "b2b_buyer_role";')
    this.addSql('drop function if exists "b2b_buyer_role_membership_revision"();')
    this.addSql('drop trigger if exists "b2b_buyer_membership_revision" on "b2b_buyer_membership";')
    this.addSql('drop function if exists "b2b_buyer_membership_revision"();')
    this.addSql(
      'drop trigger if exists "b2b_organisation_relationship_revision" on "b2b_organisation";',
    )
    this.addSql('drop function if exists "b2b_organisation_relationship_revision"();')
    this
      .addSql(`alter table "b2b_buyer_membership" drop constraint if exists "b2b_buyer_membership_revision_check",
      drop column if exists "revision";`)
    this.addSql(`alter table "b2b_organisation"
      drop constraint if exists "b2b_organisation_link_provenance_check",
      drop constraint if exists "b2b_organisation_relationship_revision_check",
      drop constraint if exists "b2b_organisation_engine_instance_check",
      drop column if exists "link_provenance",
      drop column if exists "relationship_revision",
      drop column if exists "engine_instance_id";`)
  }
}
