import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/** DEV-07 Trade-owned RFQ/quotation persistence. No buying/provider activation. */
export class Migration20261029130000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`CREATE TABLE trade_commercial_resource (
      resource_id text PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('RFQ','QUOTATION')),
      tenant_id text NOT NULL,
      buyer_organisation_id text NOT NULL REFERENCES b2b_organisation(id),
      digital_estate_id text NOT NULL,
      market_id text NOT NULL,
      legal_entity_id text NOT NULL,
      parent_id text REFERENCES trade_commercial_resource(resource_id),
      version integer NOT NULL CHECK (version >= 1),
      status text NOT NULL,
      document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
      CHECK ((kind='RFQ' AND parent_id IS NULL) OR (kind='QUOTATION' AND parent_id IS NOT NULL)));
    CREATE INDEX trade_commercial_resource_scope ON trade_commercial_resource
      (tenant_id,buyer_organisation_id,digital_estate_id,market_id,legal_entity_id,kind,resource_id);
    CREATE UNIQUE INDEX trade_commercial_one_open_quote ON trade_commercial_resource(parent_id)
      WHERE kind='QUOTATION' AND status IN ('DRAFT','ISSUED','ACCEPTED');
    CREATE TABLE trade_commercial_command (
      scope_digest text NOT NULL,
      idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'),
      request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
      response jsonb NOT NULL,
      action text NOT NULL,
      actor_principal_id text NOT NULL,
      decision_id uuid NOT NULL,
      evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 500),
      PRIMARY KEY(scope_digest,idempotency_key));
    CREATE TABLE trade_commercial_event (
      event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      resource_id text NOT NULL REFERENCES trade_commercial_resource(resource_id),
      version integer NOT NULL,
      document jsonb NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(resource_id,version));
    CREATE FUNCTION trade_commercial_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'commercial history and idempotency receipts are immutable'; END $$;
    CREATE TRIGGER trade_commercial_command_immutable BEFORE UPDATE OR DELETE ON trade_commercial_command
      FOR EACH ROW EXECUTE FUNCTION trade_commercial_immutable();
    CREATE TRIGGER trade_commercial_command_no_truncate BEFORE TRUNCATE ON trade_commercial_command
      FOR EACH STATEMENT EXECUTE FUNCTION trade_commercial_immutable();
    CREATE TRIGGER trade_commercial_event_immutable BEFORE UPDATE OR DELETE ON trade_commercial_event
      FOR EACH ROW EXECUTE FUNCTION trade_commercial_immutable();
    CREATE TRIGGER trade_commercial_event_no_truncate BEFORE TRUNCATE ON trade_commercial_event
      FOR EACH STATEMENT EXECUTE FUNCTION trade_commercial_immutable();
    CREATE FUNCTION trade_commercial_resource_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE parent trade_commercial_resource%ROWTYPE; allowed boolean := false;
    BEGIN
      IF TG_OP IN ('DELETE','TRUNCATE') THEN
        RAISE EXCEPTION 'commercial resources retain their history';
      END IF;
      IF (NEW.document->>'version')::numeric IS DISTINCT FROM NEW.version
         OR NEW.document->>'status' IS DISTINCT FROM NEW.status
         OR NEW.document->'context'->>'tenant_id' IS DISTINCT FROM NEW.tenant_id
         OR NEW.document->'context'->>'buyer_organisation_id' IS DISTINCT FROM NEW.buyer_organisation_id
         OR NEW.document->'context'->>'digital_estate_id' IS DISTINCT FROM NEW.digital_estate_id
         OR NEW.document->'context'->>'market_id' IS DISTINCT FROM NEW.market_id
         OR NEW.document->'context'->>'legal_entity_id' IS DISTINCT FROM NEW.legal_entity_id
         OR NEW.document->>(CASE NEW.kind WHEN 'RFQ' THEN 'rfq_id' ELSE 'quotation_id' END) IS DISTINCT FROM NEW.resource_id THEN
        RAISE EXCEPTION 'commercial document scope/version mismatch';
      END IF;
      IF TG_OP='INSERT' THEN
        IF NEW.version<>1 OR (NEW.kind='RFQ' AND NEW.status<>'DRAFT')
           OR (NEW.kind='QUOTATION' AND NEW.status<>'ISSUED') THEN
          RAISE EXCEPTION 'commercial invalid initial state';
        END IF;
        IF NEW.kind='QUOTATION' THEN
          SELECT * INTO parent FROM trade_commercial_resource WHERE resource_id=NEW.parent_id FOR UPDATE;
          IF parent.kind IS DISTINCT FROM 'RFQ' OR parent.status IS DISTINCT FROM 'UNDER_REVIEW'
             OR (parent.tenant_id,parent.buyer_organisation_id,parent.digital_estate_id,parent.market_id,parent.legal_entity_id)
                IS DISTINCT FROM (NEW.tenant_id,NEW.buyer_organisation_id,NEW.digital_estate_id,NEW.market_id,NEW.legal_entity_id)
             OR NEW.document->>'rfq_id' IS DISTINCT FROM parent.resource_id
             OR NEW.document->'context' IS DISTINCT FROM parent.document->'context'
             OR (NEW.document->>'valid_until')::timestamptz <= clock_timestamp() THEN
            RAISE EXCEPTION 'commercial quote parent/scope/expiry mismatch';
          END IF;
        END IF;
      ELSE
        IF (to_jsonb(NEW)-'status'-'version'-'document') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'version'-'document')
           OR (NEW.document-'status'-'version'-'updated_at') IS DISTINCT FROM (OLD.document-'status'-'version'-'updated_at')
           OR NEW.version<>OLD.version+1 THEN
          RAISE EXCEPTION 'commercial immutable content or stale version';
        END IF;
        IF NEW.kind='RFQ' THEN
          allowed := CASE OLD.status
            WHEN 'DRAFT' THEN NEW.status IN ('SUBMITTED','WITHDRAWN')
            WHEN 'SUBMITTED' THEN NEW.status IN ('UNDER_REVIEW','DECLINED','WITHDRAWN','EXPIRED')
            WHEN 'UNDER_REVIEW' THEN NEW.status IN ('QUOTED','DECLINED','WITHDRAWN','EXPIRED')
            WHEN 'QUOTED' THEN NEW.status IN ('UNDER_REVIEW','CLOSED','WITHDRAWN','EXPIRED') ELSE false END;
          IF NEW.status='QUOTED' AND NOT EXISTS (SELECT 1 FROM trade_commercial_resource
               WHERE parent_id=NEW.resource_id AND kind='QUOTATION' AND status='ISSUED') THEN allowed := false; END IF;
        ELSE
          -- Binding acceptance/conversion require the separately qualified native
          -- receipt/reservation fence. SQL has no bypass through a generic status update.
          allowed := OLD.status='ISSUED' AND NEW.status IN ('REJECTED','WITHDRAWN','EXPIRED');
          IF NEW.status='EXPIRED' THEN
            allowed := allowed AND (OLD.document->>'valid_until')::timestamptz <= clock_timestamp();
          ELSE
            allowed := allowed AND (OLD.document->>'valid_until')::timestamptz > clock_timestamp();
          END IF;
        END IF;
        IF NEW.kind='RFQ' AND NEW.status IN ('UNDER_REVIEW','CLOSED','WITHDRAWN','EXPIRED') AND EXISTS (SELECT 1 FROM trade_commercial_resource WHERE parent_id=NEW.resource_id AND kind='QUOTATION' AND status IN ('ISSUED','ACCEPTED')) THEN allowed := false; END IF;
        IF NOT coalesce(allowed,false) THEN RAISE EXCEPTION 'commercial invalid lifecycle transition'; END IF;
      END IF;
      NEW.document := jsonb_set(NEW.document,'{updated_at}',to_jsonb(clock_timestamp()));
      IF TG_OP='INSERT' THEN NEW.document := jsonb_set(NEW.document,'{created_at}',NEW.document->'updated_at'); END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trade_commercial_resource_guard BEFORE INSERT OR UPDATE OR DELETE ON trade_commercial_resource
      FOR EACH ROW EXECUTE FUNCTION trade_commercial_resource_guard();
    CREATE TRIGGER trade_commercial_resource_no_truncate BEFORE TRUNCATE ON trade_commercial_resource
      FOR EACH STATEMENT EXECUTE FUNCTION trade_commercial_resource_guard();
    CREATE FUNCTION trade_commercial_event_append() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO trade_commercial_event(resource_id,version,document)
        VALUES(NEW.resource_id,NEW.version,NEW.document); RETURN NULL; END $$;
    CREATE TRIGGER trade_commercial_event_append AFTER INSERT OR UPDATE ON trade_commercial_resource
      FOR EACH ROW EXECUTE FUNCTION trade_commercial_event_append();
    CREATE FUNCTION trade_commercial_event_origin() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF pg_trigger_depth()<2 OR NOT EXISTS(SELECT 1 FROM trade_commercial_resource
           WHERE resource_id=NEW.resource_id AND version=NEW.version AND document=NEW.document) THEN
          RAISE EXCEPTION 'commercial events originate in the resource transaction';
        END IF;
        RETURN NEW;
      END $$;
    CREATE TRIGGER trade_commercial_event_origin BEFORE INSERT ON trade_commercial_event
      FOR EACH ROW EXECUTE FUNCTION trade_commercial_event_origin();`)
  }
  async down(): Promise<void> {
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'commercial rollback requires reviewed preservation of resource history'; END $$;`,
    )
  }
}
