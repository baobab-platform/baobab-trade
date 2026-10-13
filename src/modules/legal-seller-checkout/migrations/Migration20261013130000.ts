import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/** P0-04B-01: installed lifecycle, not a reference DDL or an activation grant. */
export class Migration20261013130000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE native_seller_cart_binding
      ADD COLUMN IF NOT EXISTS proposal_snapshot jsonb,
      ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0);`)
    this.addSql(`CREATE TABLE la05_binding_decision (
      id uuid PRIMARY KEY,
      binding_id text NOT NULL REFERENCES native_seller_cart_binding(id),
      binding_revision integer NOT NULL CHECK (binding_revision >= 0),
      cart_id text NOT NULL,tenant_id text NOT NULL,organisation_id text NOT NULL,
      market_code text NOT NULL,currency_code text NOT NULL,
      decision text NOT NULL CHECK (decision IN ('PROPOSED','APPROVED','REVOKED')),
      actor_subject text NOT NULL CHECK (length(btrim(actor_subject)) > 0),
      actor_issuer text NOT NULL CHECK (length(btrim(actor_issuer)) > 0),
      actor_token_id text NOT NULL CHECK (length(btrim(actor_token_id)) > 0),
      evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) > 0),
      evidence_decision_id text NOT NULL CHECK (length(btrim(evidence_decision_id)) > 0),
      scope_snapshot jsonb NOT NULL CHECK (jsonb_typeof(scope_snapshot) = 'object'),
      reason text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(binding_id,binding_revision),
      CHECK (decision <> 'REVOKED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0))
    );`)
    this.addSql(`CREATE TABLE la05_binding_outbox (
      id uuid PRIMARY KEY,decision_id uuid NOT NULL REFERENCES la05_binding_decision(id),
      event_type text NOT NULL CHECK (event_type IN ('trade.binding.proposed.candidate',
        'trade.binding.approved.candidate','trade.binding.revoked.candidate')),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(decision_id,event_type)
    );`)
    this.addSql(`CREATE FUNCTION la05_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Binding history cannot be deleted'; END IF;
      IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PROPOSED' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL
          OR NEW.approval_reference IS NOT NULL OR NEW.context_id <> 'PENDING'
          OR NEW.market_key <> 'PENDING' OR NEW.legal_activity <> 'PENDING' OR NEW.legal_capability <> 'PENDING'
          OR NEW.proposal_snapshot IS NULL OR jsonb_typeof(NEW.proposal_snapshot) <> 'object'
          OR NEW.deleted_at IS NOT NULL THEN
          RAISE EXCEPTION 'New bindings require an inactive original proposal';
        END IF;
        NEW.revision := 0;
      ELSE
        -- Freeze all provenance/business fields, including expiry and original
        -- proposal. Neither generated CRUD nor a rewritten request can replace it.
        IF (to_jsonb(NEW) - ARRAY['approved_by','approved_at','approval_reference','status','updated_at','revision'])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['approved_by','approved_at','approval_reference','status','updated_at','revision']) THEN
          RAISE EXCEPTION 'Binding proposal scope is immutable';
        END IF;
        IF OLD.status IN ('PROPOSED','ACTIVE') AND NEW.status = 'REVOKED' THEN
          IF ROW(NEW.approved_by,NEW.approved_at,NEW.approval_reference)
            IS DISTINCT FROM ROW(OLD.approved_by,OLD.approved_at,OLD.approval_reference) THEN
            RAISE EXCEPTION 'Revocation cannot rewrite approval';
          END IF;
        ELSIF OLD.status = 'PROPOSED' AND NEW.status = 'PROPOSED' AND OLD.approved_by IS NULL
          AND NEW.approved_by IS NOT NULL AND NEW.proposal_snapshot IS NOT NULL THEN
          IF NEW.approved_by = NEW.proposed_by OR NEW.approved_at IS NULL OR NEW.approval_reference IS NULL
            OR length(btrim(NEW.approval_reference)) = 0 OR NEW.approved_at < NEW.proposed_at
            OR NEW.approved_at > clock_timestamp() OR NEW.expires_at <= clock_timestamp() THEN
            RAISE EXCEPTION 'Independent current approval required';
          END IF;
        ELSE
          -- No activation path is installed in this gate. Even an SDK update to
          -- ACTIVE cannot bypass later authenticated CP-owned context issuance.
          RAISE EXCEPTION 'Binding activation or replay is not admitted';
        END IF;
        NEW.revision := OLD.revision + 1;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER la05_binding_immutable BEFORE INSERT OR UPDATE OR DELETE
      ON native_seller_cart_binding FOR EACH ROW EXECUTE FUNCTION la05_binding_immutable();`)
    this.addSql(`CREATE FUNCTION la05_binding_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Binding decision/audit records are append-only'; END $$;
      CREATE TRIGGER la05_decision_append_only BEFORE UPDATE OR DELETE ON la05_binding_decision
        FOR EACH ROW EXECUTE FUNCTION la05_binding_append_only();
      CREATE TRIGGER la05_outbox_append_only BEFORE UPDATE OR DELETE ON la05_binding_outbox
        FOR EACH ROW EXECUTE FUNCTION la05_binding_append_only();`)
    this.addSql(`CREATE FUNCTION la05_binding_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE receipt la05_binding_decision%ROWTYPE; expected text; scoped jsonb;
    BEGIN
      expected := CASE WHEN NEW.status = 'REVOKED' THEN 'REVOKED'
        WHEN NEW.approved_by IS NOT NULL THEN 'APPROVED' ELSE 'PROPOSED' END;
      scoped := jsonb_build_object('cartId',NEW.cart_id,'tenantId',NEW.tenant_id,
        'organisationId',NEW.organisation_id,'responsibleLegalEntityId',NEW.responsible_legal_entity_id,
        'marketCode',NEW.market_code,'currencyCode',NEW.currency_code,
        'salesChannelId',NEW.sales_channel_id,'regionId',NEW.region_id);
      SELECT * INTO receipt FROM la05_binding_decision
        WHERE binding_id = NEW.id AND binding_revision = NEW.revision;
      IF NOT FOUND OR receipt.decision <> expected OR receipt.scope_snapshot <> scoped
        OR receipt.cart_id <> NEW.cart_id OR receipt.tenant_id <> NEW.tenant_id
        OR receipt.organisation_id <> NEW.organisation_id OR receipt.market_code <> NEW.market_code
        OR receipt.currency_code <> NEW.currency_code THEN
        RAISE EXCEPTION 'Atomic binding decision receipt required';
      END IF;
      IF expected <> 'REVOKED' THEN
        -- This runs at COMMIT, after lock waits AND the audit inserts. Transaction
        -- timestamps would incorrectly retain the pre-wait admission clock.
        IF NEW.expires_at <= clock_timestamp() OR NEW.proposed_at > clock_timestamp()
          OR NEW.proposal_snapshot->'scope' IS DISTINCT FROM scoped
          OR NEW.proposal_snapshot->'maker'->>'subject' IS DISTINCT FROM NEW.proposed_by
          OR (NEW.proposal_snapshot->>'proposedAt')::timestamptz IS DISTINCT FROM NEW.proposed_at
          OR (NEW.proposal_snapshot->>'expiresAt')::timestamptz IS DISTINCT FROM NEW.expires_at THEN
          RAISE EXCEPTION 'Original unexpired binding proposal required';
        END IF;
        IF expected = 'PROPOSED' AND (receipt.actor_subject <> NEW.proposed_by
          OR receipt.actor_issuer IS DISTINCT FROM NEW.proposal_snapshot->'maker'->>'issuer'
          OR receipt.actor_token_id IS DISTINCT FROM NEW.proposal_snapshot->'maker'->>'tokenId'
          OR receipt.evidence_reference IS DISTINCT FROM NEW.proposal_snapshot->>'evidenceReference') THEN
          RAISE EXCEPTION 'Original maker/evidence receipt required';
        END IF;
        IF expected = 'APPROVED' AND (receipt.actor_subject <> NEW.approved_by
          OR receipt.actor_subject = NEW.proposed_by OR receipt.evidence_reference <> NEW.approval_reference) THEN
          RAISE EXCEPTION 'Independent approval receipt required';
        END IF;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM la05_binding_outbox WHERE decision_id=receipt.id
        AND event_type='trade.binding.' || lower(expected) || '.candidate'
        AND payload = jsonb_build_object('decision_id',receipt.id::text,'binding_id',NEW.id,
          'binding_revision',NEW.revision,'actor_subject',receipt.actor_subject,
          'evidence_decision_id',receipt.evidence_decision_id)) THEN
        RAISE EXCEPTION 'Atomic local audit receipt required';
      END IF;
      RETURN NULL;
    END $$;
    CREATE CONSTRAINT TRIGGER la05_binding_receipt AFTER INSERT OR UPDATE ON native_seller_cart_binding
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION la05_binding_receipt();`)
  }

  async down(): Promise<void> {
    // Recorded legal/security history is never silently dropped by rollback.
    this.addSql(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM la05_binding_decision) THEN
      RAISE EXCEPTION 'Binding history exists; restore/rollback requires a reviewed preservation plan';
      END IF; END $$;`)
    this.addSql(`DROP TRIGGER la05_binding_receipt ON native_seller_cart_binding;
      DROP TRIGGER la05_binding_immutable ON native_seller_cart_binding;
      DROP FUNCTION la05_binding_receipt(); DROP FUNCTION la05_binding_immutable();
      DROP TABLE la05_binding_outbox; DROP TABLE la05_binding_decision;
      DROP FUNCTION la05_binding_append_only();
      ALTER TABLE native_seller_cart_binding DROP COLUMN proposal_snapshot,DROP COLUMN revision;`)
  }
}
