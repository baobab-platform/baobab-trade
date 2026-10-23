import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-042 section 14 Decisions 6, 8 and 9 (ADR-0034, ADR-0036): the
 * universal native commit fence. It selects the authorization regime from the
 * resource's NativeCommitmentClassification (Migration20261022210000) and sits
 * behind an inactive enforcement gate.
 *
 * The TA-07 fence (Migration20261021090000) consumes the seller receipt and
 * records a trade_order_commitment for every cart commit and draft
 * finalisation, whatever path wrote the order: BFF checkout, server
 * application, admin, job, callback or replay. At COMMIT of that same
 * transaction this check evaluates, for the committed cart or draft:
 *
 *   1. exactly one ACTIVE classification. None is CLASSIFICATION_ABSENT, or
 *      CLASSIFICATION_CHANGED when the resource's classification was retired:
 *      there is no native order commitment without a known classification,
 *      which itself needs CP-verified estate provenance (an estate client
 *      binding or a governed resource assignment), and never a fall-through
 *      to B2C;
 *   2. that it names the same Tenant and seller binding version as the seller
 *      receipt being consumed (CLASSIFICATION_CONFLICT);
 *   3. that the CP commerce profile is still ACTIVE: the latest CP answer for
 *      that estate, engine instance and Market is a live ATTESTED observation
 *      of the same profile, Tenant and model at the classified or a later
 *      revision (PROFILE_NOT_ACTIVE);
 *   4. the regime. B2C: the seller receipt already consumed here. B2B: the
 *      buyer-authority receipt and its spend reservation consumed in this
 *      transaction (Decision 6). Until the CAA-06b composition persists
 *      those, every B2B commitment is BUYER_AUTHORITY_ABSENT and none is ever
 *      reinterpreted as B2C.
 *
 * Enforcement gate (Decision 9: implement behind an inactive gate; activate
 * only on connected evidence, an approved scope allocation and rollback
 * safeguards). trade_commit_fence_enforcement holds one governed row, SHADOW
 * by default:
 *
 *   - every evaluation is appended to trade_commit_fence_decision in the
 *     order's own transaction, so in SHADOW the verdict the fence would give
 *     is evidence before it is ever enforced (an ENFORCED refusal rolls back
 *     with the order; its evidence is the raised refusal);
 *   - ENFORCED raises on any refusal, so the order, the receipt consumption
 *     and the commitment roll back together;
 *   - the mode changes only by a new revision naming its evidence; the row is
 *     never deleted, and there is no session, caller or path exemption.
 *
 * This migration leaves the gate in SHADOW. It activates nothing.
 */
export class Migration20261023120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`DO $$ BEGIN
      IF to_regclass('public.trade_order_commitment') IS NULL
         OR to_regclass('public.trade_native_commitment_classification') IS NULL THEN
        RAISE EXCEPTION 'Decision 8 commit check requires the TA-07 fence and the classification record';
      END IF;
    END $$;`)

    this.addSql(`CREATE TABLE trade_commit_fence_enforcement (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      mode text NOT NULL CHECK (mode IN ('SHADOW', 'ENFORCED')),
      revision integer NOT NULL CHECK (revision >= 1),
      change_reference text NOT NULL CHECK (length(btrim(change_reference)) BETWEEN 1 AND 500),
      changed_at timestamptz NOT NULL DEFAULT clock_timestamp());
    INSERT INTO trade_commit_fence_enforcement (mode, revision, change_reference)
      VALUES ('SHADOW', 1, 'Migration20261023120000: implemented behind an inactive enforcement gate');
    CREATE FUNCTION trade_commit_fence_enforcement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP <> 'UPDATE' THEN
        RAISE EXCEPTION 'Decision 9: the commit fence enforcement gate is one governed row; it is never added or removed';
      END IF;
      IF NEW.revision <> OLD.revision + 1 OR NEW.change_reference = OLD.change_reference THEN
        RAISE EXCEPTION 'Decision 9: an enforcement change needs the next revision and its own evidence reference';
      END IF;
      NEW.changed_at := clock_timestamp();
      RETURN NEW;
    END $$;
    CREATE TRIGGER trade_commit_fence_enforcement_guard
      BEFORE INSERT OR UPDATE OR DELETE ON trade_commit_fence_enforcement
      FOR EACH ROW EXECUTE FUNCTION trade_commit_fence_enforcement_guard();
    CREATE TRIGGER trade_commit_fence_enforcement_no_truncate
      BEFORE TRUNCATE ON trade_commit_fence_enforcement
      FOR EACH STATEMENT EXECUTE FUNCTION trade_commit_fence_enforcement_guard();`)

    this.addSql(`CREATE TABLE trade_commit_fence_decision (
      decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_type text NOT NULL,
      subject_id text NOT NULL,
      receipt_id uuid NOT NULL,
      classification_id uuid,
      commerce_model text CHECK (commerce_model IN ('B2B', 'B2C')),
      outcome text NOT NULL CHECK (outcome IN ('ALLOWED', 'CLASSIFICATION_ABSENT', 'CLASSIFICATION_CHANGED',
        'CLASSIFICATION_CONFLICT', 'PROFILE_NOT_ACTIVE', 'BUYER_AUTHORITY_ABSENT')),
      enforcement_mode text NOT NULL CHECK (enforcement_mode IN ('SHADOW', 'ENFORCED')),
      enforcement_revision integer NOT NULL,
      decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (outcome <> 'ALLOWED' OR (classification_id IS NOT NULL AND commerce_model IS NOT NULL)));
    CREATE INDEX trade_commit_fence_decision_subject ON trade_commit_fence_decision (subject_type, subject_id);
    CREATE FUNCTION trade_commit_fence_decision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Decision 9: commit fence decisions are append-only evidence';
    END $$;
    -- A verdict is written only from inside the fence trigger, for an existing
    -- commitment with the same receipt and subject: never by a direct INSERT,
    -- so the shadow evidence that justifies activation cannot be forged.
    CREATE FUNCTION trade_commit_fence_decision_origin() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF pg_trigger_depth() < 2 OR NOT EXISTS (SELECT 1 FROM trade_order_commitment oc
           WHERE oc.receipt_id = NEW.receipt_id AND oc.subject_type = NEW.subject_type
             AND oc.subject_id = NEW.subject_id) THEN
        RAISE EXCEPTION 'Decision 9: commit fence decisions are written only by the commit fence';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trade_commit_fence_decision_origin
      BEFORE INSERT ON trade_commit_fence_decision
      FOR EACH ROW EXECUTE FUNCTION trade_commit_fence_decision_origin();
    CREATE TRIGGER trade_commit_fence_decision_immutable
      BEFORE UPDATE OR DELETE ON trade_commit_fence_decision
      FOR EACH ROW EXECUTE FUNCTION trade_commit_fence_decision_immutable();
    CREATE TRIGGER trade_commit_fence_decision_no_truncate
      BEFORE TRUNCATE ON trade_commit_fence_decision
      FOR EACH STATEMENT EXECUTE FUNCTION trade_commit_fence_decision_immutable();`)

    this
      .addSql(`CREATE FUNCTION trade_order_commitment_classification() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE c trade_native_commitment_classification%ROWTYPE; r trade_order_authority_receipt%ROWTYPE;
            latest trade_commerce_profile_observation%ROWTYPE; gate trade_commit_fence_enforcement%ROWTYPE;
            reason text;
    BEGIN
      -- FOR SHARE serializes the verdict with a gate change: an uncommitted
      -- switch blocks this check until it commits, and this check holds off a
      -- switch until the order's transaction ends. There is no window in which
      -- an order commits under the mode it was not evaluated in.
      SELECT * INTO gate FROM trade_commit_fence_enforcement WHERE singleton FOR SHARE;
      IF gate.mode IS NULL THEN
        RAISE EXCEPTION 'Decision 9 denied: the commit fence enforcement gate is missing';
      END IF;

      SELECT * INTO c FROM trade_native_commitment_classification
        WHERE resource_type = NEW.subject_type AND resource_id = NEW.subject_id AND status = 'ACTIVE';
      IF c.classification_id IS NULL THEN
        reason := CASE WHEN EXISTS (SELECT 1 FROM trade_native_commitment_classification
             WHERE resource_type = NEW.subject_type AND resource_id = NEW.subject_id)
          THEN 'CLASSIFICATION_CHANGED' ELSE 'CLASSIFICATION_ABSENT' END;
      END IF;

      IF reason IS NULL THEN
        SELECT * INTO r FROM trade_order_authority_receipt WHERE receipt_id = NEW.receipt_id;
        IF r.receipt_id IS NULL OR r.tenant_id <> c.tenant_id OR r.binding_id <> c.seller_binding_id
           OR r.binding_version <> c.seller_binding_version THEN
          reason := 'CLASSIFICATION_CONFLICT';
        END IF;
      END IF;

      IF reason IS NULL THEN
        SELECT * INTO latest FROM trade_commerce_profile_observation
          WHERE digital_estate_id = c.digital_estate_id AND engine_instance_id = c.trade_engine_instance_id
            AND market_id = c.market_id
          ORDER BY observed_at DESC, observation_id DESC LIMIT 1;
        IF latest.observation_id IS NULL OR latest.outcome <> 'ATTESTED'
           OR latest.commerce_profile_id <> c.commerce_profile_id
           OR latest.profile_revision < c.profile_revision
           OR latest.commerce_model <> c.commerce_model OR latest.tenant_id <> c.tenant_id
           OR latest.expires_at <= clock_timestamp() THEN
          reason := 'PROFILE_NOT_ACTIVE';
        END IF;
      END IF;

      -- Until the CAA-06b composition consumes the buyer-authority receipt and
      -- its spend reservation here, no B2B commitment passes.
      IF reason IS NULL AND c.commerce_model = 'B2B' THEN
        reason := 'BUYER_AUTHORITY_ABSENT';
      END IF;

      INSERT INTO trade_commit_fence_decision (subject_type, subject_id, receipt_id, classification_id, commerce_model,
          outcome, enforcement_mode, enforcement_revision)
        VALUES (NEW.subject_type, NEW.subject_id, NEW.receipt_id, c.classification_id, c.commerce_model,
          coalesce(reason, 'ALLOWED'), gate.mode, gate.revision);

      IF reason IS NOT NULL AND gate.mode = 'ENFORCED' THEN
        RAISE EXCEPTION 'Decision 8 denied (%): %', reason, CASE reason
          WHEN 'CLASSIFICATION_ABSENT' THEN 'no native commitment without a known classification'
          WHEN 'CLASSIFICATION_CHANGED' THEN 'the classification was retired; governed reconciliation and reauthorization are required'
          WHEN 'CLASSIFICATION_CONFLICT' THEN 'the classification and the seller receipt disagree'
          WHEN 'PROFILE_NOT_ACTIVE' THEN 'no current CP commerce profile attestation for the classification'
          ELSE 'a B2B commitment requires the buyer-authority receipt and its spend reservation in this transaction' END;
      END IF;
      RETURN NULL;
    END $$;
    CREATE CONSTRAINT TRIGGER trade_order_commitment_classification AFTER INSERT
      ON trade_order_commitment DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION trade_order_commitment_classification();`)
  }

  async down(): Promise<void> {
    // Removing the fence or its evidence would let a native commitment proceed unexamined.
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'Decision 9 commit fence rollback requires a reviewed decision; set the gate to SHADOW instead'; END $$;`,
    )
  }
}
