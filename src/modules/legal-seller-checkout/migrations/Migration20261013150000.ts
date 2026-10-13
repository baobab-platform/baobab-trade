import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/** Explicit P0-04B-02 extension: old snapshots/receipts are never rewritten. */
export class Migration20261013150000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE native_seller_cart_binding ADD COLUMN activation_snapshot jsonb;
    ALTER TABLE la05_binding_decision ADD COLUMN authorization_snapshot jsonb;
    ALTER TABLE la05_binding_decision DROP CONSTRAINT la05_binding_decision_decision_check;
    ALTER TABLE la05_binding_decision ADD CHECK (decision IN ('PROPOSED','APPROVED','REVOKED','ACTIVATED'));
    ALTER TABLE la05_binding_outbox DROP CONSTRAINT la05_binding_outbox_event_type_check;
    ALTER TABLE la05_binding_outbox ADD CHECK (event_type IN ('trade.binding.proposed.candidate','trade.binding.approved.candidate','trade.binding.revoked.candidate','trade.binding.activated.candidate'));
    CREATE TABLE la05_binding_activation (binding_id text NOT NULL REFERENCES native_seller_cart_binding(id),
      binding_revision integer NOT NULL CHECK (binding_revision>=2),proof jsonb NOT NULL CHECK (jsonb_typeof(proof)='object'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(binding_id,binding_revision));
    CREATE TRIGGER la05_activation_append_only BEFORE UPDATE OR DELETE ON la05_binding_activation
      FOR EACH ROW EXECUTE FUNCTION la05_binding_append_only();`)
    this
      .addSql(`CREATE OR REPLACE FUNCTION la05_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Binding history cannot be deleted'; END IF;
      IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PROPOSED' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL
          OR NEW.approval_reference IS NOT NULL OR NEW.context_id <> 'PENDING'
          OR NEW.market_key <> 'PENDING' OR NEW.legal_activity <> 'PENDING' OR NEW.legal_capability <> 'PENDING'
          OR NEW.proposal_snapshot IS NULL OR jsonb_typeof(NEW.proposal_snapshot) <> 'object'
          OR NEW.activation_snapshot IS NOT NULL OR NEW.deleted_at IS NOT NULL THEN
          RAISE EXCEPTION 'New bindings require an inactive original proposal';
        END IF;
        NEW.revision := 0;
      ELSE
        -- Freeze all provenance/business fields, including expiry and original
        -- proposal. Neither generated CRUD nor a rewritten request can replace it.
        IF (to_jsonb(NEW) - ARRAY['approved_by','approved_at','approval_reference','status','updated_at','revision','context_id','market_key','legal_activity','legal_capability','activation_snapshot'])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['approved_by','approved_at','approval_reference','status','updated_at','revision','context_id','market_key','legal_activity','legal_capability','activation_snapshot']) THEN
          RAISE EXCEPTION 'Binding proposal scope is immutable';
        END IF;
        IF NEW.status <> 'ACTIVE' AND ROW(NEW.context_id,NEW.market_key,NEW.legal_activity,NEW.legal_capability,NEW.activation_snapshot)
          IS DISTINCT FROM ROW(OLD.context_id,OLD.market_key,OLD.legal_activity,OLD.legal_capability,OLD.activation_snapshot) THEN
          RAISE EXCEPTION 'Activation history is immutable';
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
        ELSIF OLD.status='PROPOSED' AND NEW.status='ACTIVE' AND OLD.approved_by IS NOT NULL
          AND OLD.activation_snapshot IS NULL AND NEW.activation_snapshot IS NOT NULL THEN
          IF ROW(NEW.approved_by,NEW.approved_at,NEW.approval_reference) IS DISTINCT FROM ROW(OLD.approved_by,OLD.approved_at,OLD.approval_reference)
            OR NEW.context_id='PENDING' OR NEW.market_key='PENDING'
            OR NEW.legal_activity<>'B2B_COFFEE_SALE' OR NEW.legal_capability<>'commerce.order.create'
            OR NEW.activation_snapshot->>'revision' IS DISTINCT FROM OLD.revision::text THEN
            RAISE EXCEPTION 'Independent versioned activation required';
          END IF;
        ELSE
          -- Generated CRUD/replay cannot bypass the versioned activation receipt.
          RAISE EXCEPTION 'Binding activation or replay is not admitted';
        END IF;
        NEW.revision := OLD.revision + 1;
      END IF;
      RETURN NEW;
    END $$;
    `)
    this
      .addSql(`CREATE OR REPLACE FUNCTION la05_binding_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE receipt la05_binding_decision%ROWTYPE; expected text; scoped jsonb;
    BEGIN
      expected := CASE WHEN NEW.status = 'REVOKED' THEN 'REVOKED'
        WHEN NEW.status='ACTIVE' THEN 'ACTIVATED' WHEN NEW.approved_by IS NOT NULL THEN 'APPROVED' ELSE 'PROPOSED' END;
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
      IF receipt.authorization_snapshot IS NOT NULL THEN
        IF NOT receipt.authorization_snapshot ?& ARRAY['scope','principal_id','issuer','token_id','decision_id','scope_name','evaluated_at','valid_until','command_digest','matched_grant_ids','provider_permissions_granted']
          OR jsonb_typeof(receipt.authorization_snapshot->'matched_grant_ids') IS DISTINCT FROM 'array'
          OR receipt.authorization_snapshot->>'provider_permissions_granted' IS DISTINCT FROM 'false'
          OR receipt.authorization_snapshot->>'command_digest' !~ '^[a-f0-9]{64}$'
          OR receipt.authorization_snapshot->'scope' IS DISTINCT FROM scoped
          OR receipt.authorization_snapshot->>'principal_id' IS DISTINCT FROM receipt.actor_subject
          OR receipt.authorization_snapshot->>'issuer' IS DISTINCT FROM receipt.actor_issuer
          OR receipt.authorization_snapshot->>'token_id' IS DISTINCT FROM receipt.actor_token_id
          OR receipt.authorization_snapshot->>'decision_id' IS DISTINCT FROM receipt.evidence_decision_id
          OR receipt.evidence_reference IS DISTINCT FROM 'cp/trade-binding/' || receipt.evidence_decision_id
          OR receipt.authorization_snapshot->>'scope_name' IS DISTINCT FROM
            ('trade-binding:' || CASE expected WHEN 'PROPOSED' THEN 'propose' WHEN 'APPROVED' THEN 'approve' WHEN 'ACTIVATED' THEN 'activate' ELSE 'revoke' END)
          OR (receipt.authorization_snapshot->>'valid_until')::timestamptz <= clock_timestamp()
          OR (receipt.authorization_snapshot->>'evaluated_at')::timestamptz > clock_timestamp()
          OR (receipt.authorization_snapshot->>'valid_until')::timestamptz > (receipt.authorization_snapshot->>'evaluated_at')::timestamptz + interval '5 seconds' THEN
          RAISE EXCEPTION 'Current exact CP command admission required at COMMIT';
        END IF;
      END IF;
      IF receipt.authorization_snapshot IS NOT NULL AND expected <> 'REVOKED' THEN
        PERFORM 1 FROM cart WHERE id=NEW.cart_id AND deleted_at IS NULL
          AND sales_channel_id=NEW.sales_channel_id AND region_id=NEW.region_id
          AND upper(currency_code)=NEW.currency_code AND completed_at IS NULL FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Current native cart coordinates required at COMMIT'; END IF;
      END IF;
      IF expected = 'ACTIVATED' THEN
        IF NOT EXISTS (SELECT 1 FROM la05_binding_decision maker JOIN la05_binding_decision checker ON checker.binding_id=maker.binding_id
          WHERE maker.binding_id=NEW.id AND maker.binding_revision=0 AND maker.decision='PROPOSED'
            AND checker.binding_revision=1 AND checker.decision='APPROVED'
            AND maker.actor_subject=NEW.proposed_by AND checker.actor_subject=NEW.approved_by
            AND maker.authorization_snapshot->>'scope_name'='trade-binding:propose'
            AND checker.authorization_snapshot->>'scope_name'='trade-binding:approve'
            AND maker.authorization_snapshot->'scope'=scoped AND checker.authorization_snapshot->'scope'=scoped) THEN
          RAISE EXCEPTION 'Authenticated original maker and checker history required';
        END IF;
        IF receipt.authorization_snapshot IS NULL OR NOT EXISTS (
          SELECT 1 FROM la05_binding_activation a WHERE a.binding_id=NEW.id AND a.binding_revision=NEW.revision
            AND a.proof=NEW.activation_snapshot
            AND a.proof->'scope'=scoped AND a.proof->'admission'=receipt.authorization_snapshot
            AND a.proof->'actor'->>'subject'=receipt.actor_subject
            AND receipt.actor_subject NOT IN (NEW.proposed_by,NEW.approved_by)
            AND a.proof->'context'->>'context_id'=NEW.context_id
            AND a.proof->'context'->>'tenant_id'=NEW.tenant_id
            AND a.proof->'context'->>'organisation_id'=NEW.organisation_id
            AND a.proof->'context'->>'market_id'=NEW.market_key
            AND a.proof->'context'->>'country_code'=NEW.market_code
            AND a.proof->'context'->>'currency_code'=NEW.currency_code
            AND (a.proof->'context'->>'expires_at')::timestamptz>clock_timestamp()
            AND a.proof->'legalDecision'->>'context_id'=NEW.context_id
            AND a.proof->'legalDecision'->>'operation_reference'='cart/' || NEW.cart_id || '/complete'
            AND a.proof->'legalDecision'->>'provider_permissions_granted'='false'
            AND a.proof->'legalDecision'->'legal_actor_resolution'->>'outcome'='AUTHORIZED'
            AND a.proof->'legalDecision'->'legal_actor_resolution'->>'responsible_legal_entity_id'=NEW.responsible_legal_entity_id
            AND (a.proof->'legalDecision'->'legal_actor_resolution'->>'valid_until')::timestamptz>clock_timestamp()) THEN
          RAISE EXCEPTION 'Atomic independent CP activation proof required';
        END IF;
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
    `)
  }
  async down(): Promise<void> {
    // Rollback cannot leave ACTIVE rows under an implementation that prohibits
    // all activation, or discard approval/admission history. Preserve by review.
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'Activation migration rollback requires reviewed history preservation'; END $$;`,
    )
  }
}
