import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261128090000 extends Migration {
  async up(): Promise<void> {
    // Existing records receive a row revision without acquiring missing
    // canonical purchase, actor, or policy bindings.
    this.addSql(`alter table "b2b_purchase_approval"
      add column "revision" integer not null default 1,
      add constraint "b2b_purchase_approval_revision_positive" check ("revision" > 0);`)
    this.addSql(`create function "b2b_purchase_approval_stamp_revision"() returns trigger
      language plpgsql as $$
      begin
        if tg_op = 'INSERT' then
          new."revision" := 1;
        else
          new."revision" := old."revision" + 1;
        end if;
        return new;
      end $$;`)
    this.addSql(`create trigger "b2b_purchase_approval_stamp_revision"
      before insert or update on "b2b_purchase_approval"
      for each row execute function "b2b_purchase_approval_stamp_revision"();`)
  }

  async down(): Promise<void> {
    this.addSql('drop trigger "b2b_purchase_approval_stamp_revision" on "b2b_purchase_approval";')
    this.addSql('drop function "b2b_purchase_approval_stamp_revision"();')
    this.addSql(`alter table "b2b_purchase_approval"
      drop constraint "b2b_purchase_approval_revision_positive",
      drop column "revision";`)
  }
}
