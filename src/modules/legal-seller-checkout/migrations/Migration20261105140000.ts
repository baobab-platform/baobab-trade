import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261105140000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE event_outbox ADD COLUMN native_insert_xid text;
      CREATE FUNCTION trade_guard_native_outbox_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'TRUNCATE' THEN
          IF EXISTS (SELECT 1 FROM event_outbox WHERE native_insert_xid IS NOT NULL) THEN
            RAISE EXCEPTION 'Governed Trade outbox event is immutable';
          END IF;
          RETURN NULL;
        END IF;
        IF TG_OP = 'INSERT' THEN
          IF NEW.native_insert_xid IS NOT NULL THEN
            IF NEW.event_type <> 'com.baobab-platform.trade.order.placed.v1'
                OR NEW.envelope_digest IS NULL OR NEW.envelope_digest !~ '^[a-f0-9]{64}$' THEN
              RAISE EXCEPTION 'Invalid governed Trade outbox event';
            END IF;
            NEW.native_insert_xid := (txid_current() % 4294967296)::text;
          END IF;
          RETURN NEW;
        END IF;
        IF TG_OP = 'DELETE' THEN
          IF OLD.native_insert_xid IS NOT NULL THEN
            RAISE EXCEPTION 'Governed Trade outbox event is immutable';
          END IF;
          RETURN OLD;
        END IF;
        IF NEW.native_insert_xid IS DISTINCT FROM OLD.native_insert_xid OR
            (OLD.native_insert_xid IS NOT NULL AND
             (to_jsonb(NEW) - ARRAY['status','attempt_count','next_attempt_at','published_at',
               'lease_expires_at','last_error_code','updated_at'])
             IS DISTINCT FROM
             (to_jsonb(OLD) - ARRAY['status','attempt_count','next_attempt_at','published_at',
               'lease_expires_at','last_error_code','updated_at'])) THEN
          RAISE EXCEPTION 'Governed Trade outbox event is immutable';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trade_native_outbox_event_guard BEFORE INSERT OR UPDATE OR DELETE ON event_outbox
        FOR EACH ROW EXECUTE FUNCTION trade_guard_native_outbox_event();
      CREATE TRIGGER trade_native_outbox_event_no_truncate BEFORE TRUNCATE ON event_outbox
        FOR EACH STATEMENT EXECUTE FUNCTION trade_guard_native_outbox_event();
    `)
  }

  async down(): Promise<void> {
    this.addSql("DROP TRIGGER trade_native_outbox_event_no_truncate ON event_outbox")
    this.addSql("DROP TRIGGER trade_native_outbox_event_guard ON event_outbox")
    this.addSql("DROP FUNCTION trade_guard_native_outbox_event()")
    this.addSql("ALTER TABLE event_outbox DROP COLUMN native_insert_xid")
  }
}
