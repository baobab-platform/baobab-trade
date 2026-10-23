import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-042 section 14 Decisions 6 and 8 (ADR-0034): the native commit
 * fence selects the authorization regime from the resource's
 * NativeCommitmentClassification (Migration20261022210000).
 *
 * The TA-07 fence (Migration20261021090000) consumes the seller receipt and
 * records a trade_order_commitment for every cart commit and draft
 * finalisation, whatever path wrote the order. At COMMIT of that same
 * transaction this check requires, for the committed cart or draft:
 *
 *   1. exactly one ACTIVE classification. None is CLASSIFICATION_ABSENT, or
 *      CLASSIFICATION_CHANGED when the resource's classification was retired:
 *      there is no native order commitment without a known classification,
 *      and never a fall-through to B2C;
 *   2. that it names the same Tenant and seller binding version as the seller
 *      receipt being consumed (CLASSIFICATION_CONFLICT);
 *   3. that the CP commerce profile is still ACTIVE: a live ATTESTED
 *      observation of the same profile, estate, engine instance, Market and
 *      model at the classified or a later revision, and no later CP answer
 *      for that estate, engine instance and Market that is anything else
 *      (PROFILE_NOT_ACTIVE). Trade re-resolves within the attestation's
 *      lifetime before committing;
 *   4. the regime. B2C: the seller receipt already consumed here, with the
 *      consumer and payment controls of its own policy. B2B: the buyer-
 *      authority receipt and a matching current spend reservation consumed in
 *      this transaction (Decision 6). Until CAA-06b persists those, every B2B
 *      commitment is refused (BUYER_AUTHORITY_ABSENT) and none is ever
 *      reinterpreted as B2C.
 *
 * A refusal raises at COMMIT, so the order, the receipt consumption and the
 * commitment roll back together. It applies in every persistence posture: a
 * commitment exists only for an attributed, receipted record.
 */
export class Migration20261022220000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`DO $$ BEGIN
      IF to_regclass('public.trade_order_commitment') IS NULL
         OR to_regclass('public.trade_native_commitment_classification') IS NULL THEN
        RAISE EXCEPTION 'Decision 8 commit check requires the TA-07 fence and the classification record';
      END IF;
    END $$;`)

    this
      .addSql(`CREATE FUNCTION trade_order_commitment_classification() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE c trade_native_commitment_classification%ROWTYPE; r trade_order_authority_receipt%ROWTYPE;
            latest trade_commerce_profile_observation%ROWTYPE;
    BEGIN
      SELECT * INTO c FROM trade_native_commitment_classification
        WHERE resource_type = NEW.subject_type AND resource_id = NEW.subject_id AND status = 'ACTIVE';
      IF c.classification_id IS NULL THEN
        IF EXISTS (SELECT 1 FROM trade_native_commitment_classification
             WHERE resource_type = NEW.subject_type AND resource_id = NEW.subject_id) THEN
          RAISE EXCEPTION 'Decision 8 denied (CLASSIFICATION_CHANGED): the classification was retired; governed reconciliation and reauthorization are required';
        END IF;
        RAISE EXCEPTION 'Decision 8 denied (CLASSIFICATION_ABSENT): no native commitment without a known classification';
      END IF;

      SELECT * INTO r FROM trade_order_authority_receipt WHERE receipt_id = NEW.receipt_id;
      IF r.receipt_id IS NULL OR r.tenant_id <> c.tenant_id OR r.binding_id <> c.seller_binding_id
         OR r.binding_version <> c.seller_binding_version THEN
        RAISE EXCEPTION 'Decision 8 denied (CLASSIFICATION_CONFLICT): the classification and the seller receipt disagree';
      END IF;

      SELECT * INTO latest FROM trade_commerce_profile_observation
        WHERE digital_estate_id = c.digital_estate_id AND engine_instance_id = c.trade_engine_instance_id
          AND market_id = c.market_id
        ORDER BY observed_at DESC, observation_id DESC LIMIT 1;
      IF latest.observation_id IS NULL OR latest.outcome <> 'ATTESTED'
         OR latest.commerce_profile_id <> c.commerce_profile_id
         OR latest.profile_revision < c.profile_revision
         OR latest.commerce_model <> c.commerce_model OR latest.tenant_id <> c.tenant_id
         OR latest.expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'Decision 8 denied (PROFILE_NOT_ACTIVE): no current CP commerce profile attestation for the classification';
      END IF;

      IF c.commerce_model = 'B2B' THEN
        RAISE EXCEPTION 'Decision 8 denied (BUYER_AUTHORITY_ABSENT): a B2B commitment requires the buyer-authority receipt and its spend reservation in this transaction';
      END IF;
      RETURN NULL;
    END $$;
    CREATE CONSTRAINT TRIGGER trade_order_commitment_classification AFTER INSERT
      ON trade_order_commitment DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION trade_order_commitment_classification();`)
  }

  async down(): Promise<void> {
    // Removing the check would let a native commitment proceed without a known classification.
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'Decision 8 commit check rollback requires a reviewed decision'; END $$;`,
    )
  }
}
