import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-042 section 14 Decision 8 (Shared trade/v2
 * native-commitment-classification, control-plane/v1 estate-commerce-profile;
 * ADR-0034): Trade's immutable NativeCommitmentClassification and the CP
 * commerce profile answers it is derived from.
 *
 * 1. trade_commerce_profile_observation is the append-only record of every
 *    answer CP gave Trade. An ATTESTED row carries the whole attestation;
 *    a denial names no profile. A profile is never accepted at a revision
 *    older than one Trade has seen, or with a different scope or model.
 * 2. trade_native_commitment_classification records, once per native
 *    resource, the commerce model a CP attestation fixed for it:
 *    - only a live ATTESTED observation of the same estate, Tenant, engine
 *      instance, Market, profile, revision and model can classify;
 *    - the resource's current seller attribution must name the same Tenant,
 *      engine instance, seller binding and CP context (the context the
 *      Market came from), so the classification never floats free of the
 *      seller decision;
 *    - B2B is a buyer Organisation with a membership or approved machine
 *      mandate, B2C a consumer context; neither is inferred from the other's
 *      absence;
 *    - nothing about a classification changes after creation. The only
 *      transition is ACTIVE to SUPERSEDED or QUARANTINED; a changed model is
 *      a REPLACEMENT row naming its predecessor; a conversion carries its
 *      parent's model and is taken at most once;
 *    - nothing is deleted or truncated.
 *    Quotations have no seller attribution yet, so they cannot be classified
 *    until one exists.
 *
 * Source only: no commerce profile is registered, so in every environment
 * there is nothing to classify and the commit fence (Migration20261022220000)
 * refuses every native commitment.
 */
export class Migration20261022210000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`DO $$ BEGIN
      IF to_regclass('public.trade_commitment_attribution') IS NULL THEN
        RAISE EXCEPTION 'Decision 8 classification requires the Trade-A commitment attribution';
      END IF;
    END $$;`)

    this.addSql(`CREATE TABLE trade_commerce_profile_observation (
      observation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      digital_estate_id text NOT NULL CHECK (
        length(digital_estate_id) BETWEEN 3 AND 63 AND digital_estate_id ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
      engine_instance_id text NOT NULL CHECK (engine_instance_id ~ '^ei_[a-z0-9]+$' AND length(engine_instance_id) <= 63),
      market_id text NOT NULL CHECK (length(market_id) BETWEEN 3 AND 63 AND market_id ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
      estate_binding_id uuid NOT NULL,
      outcome text NOT NULL CHECK (outcome IN ('ATTESTED', 'PROFILE_NOT_REGISTERED', 'PROFILE_NOT_ACTIVE',
        'PROFILE_AMBIGUOUS', 'ESTATE_PROVENANCE_INVALID', 'ENGINE_INSTANCE_NOT_PERMITTED')),
      attestation_id uuid UNIQUE,
      commerce_profile_id uuid,
      profile_revision integer CHECK (profile_revision >= 1),
      tenant_id text CHECK (tenant_id ~ '^tn_[a-z0-9]+$' AND length(tenant_id) BETWEEN 6 AND 63),
      commerce_model text CHECK (commerce_model IN ('B2B', 'B2C')),
      issued_at timestamptz,
      expires_at timestamptz,
      profile_effective_until timestamptz,
      evidence_reference text CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 500),
      correlation_id uuid NOT NULL,
      observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (CASE WHEN outcome = 'ATTESTED'
        THEN attestation_id IS NOT NULL AND commerce_profile_id IS NOT NULL AND profile_revision IS NOT NULL
             AND tenant_id IS NOT NULL AND commerce_model IS NOT NULL AND evidence_reference IS NOT NULL
             AND issued_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at > issued_at
             AND expires_at <= issued_at + interval '60 seconds'
             AND (profile_effective_until IS NULL OR expires_at <= profile_effective_until)
        ELSE attestation_id IS NULL AND commerce_profile_id IS NULL AND profile_revision IS NULL
             AND tenant_id IS NULL AND commerce_model IS NULL AND issued_at IS NULL AND expires_at IS NULL
             AND profile_effective_until IS NULL AND evidence_reference IS NULL END));
    CREATE INDEX trade_commerce_profile_observation_scope
      ON trade_commerce_profile_observation (digital_estate_id, engine_instance_id, market_id, observed_at DESC);
    CREATE INDEX trade_commerce_profile_observation_profile
      ON trade_commerce_profile_observation (commerce_profile_id, profile_revision DESC)
      WHERE outcome = 'ATTESTED';`)

    this
      .addSql(`CREATE FUNCTION trade_commerce_profile_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Decision 8: commerce profile observations are append-only';
      END IF;
      IF NEW.outcome = 'ATTESTED' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('trade-commerce-profile/' || NEW.commerce_profile_id::text, 0));
        IF NEW.expires_at <= clock_timestamp() THEN
          RAISE EXCEPTION 'Decision 8 denied: the commerce profile attestation has expired';
        END IF;
        -- Never valid before it was issued (5 s clock-skew allowance, as the client).
        IF NEW.issued_at > clock_timestamp() + interval '5 seconds' THEN
          RAISE EXCEPTION 'Decision 8 denied: the commerce profile attestation is issued in the future';
        END IF;
        -- CP fixes a profile's scope and model; a contradiction is never accepted.
        IF EXISTS (SELECT 1 FROM trade_commerce_profile_observation o
             WHERE o.outcome = 'ATTESTED' AND o.commerce_profile_id = NEW.commerce_profile_id
               AND (o.digital_estate_id <> NEW.digital_estate_id OR o.tenant_id <> NEW.tenant_id
                    OR o.engine_instance_id <> NEW.engine_instance_id OR o.commerce_model <> NEW.commerce_model)) THEN
          RAISE EXCEPTION 'Decision 8 denied: the commerce profile contradicts an earlier attestation';
        END IF;
        IF EXISTS (SELECT 1 FROM trade_commerce_profile_observation o
             WHERE o.outcome = 'ATTESTED' AND o.commerce_profile_id = NEW.commerce_profile_id
               AND o.profile_revision > NEW.profile_revision) THEN
          RAISE EXCEPTION 'Decision 8 denied: the commerce profile revision is older than one already seen';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trade_commerce_profile_observation_guard
      BEFORE INSERT OR UPDATE OR DELETE ON trade_commerce_profile_observation
      FOR EACH ROW EXECUTE FUNCTION trade_commerce_profile_observation_guard();
    CREATE TRIGGER trade_commerce_profile_observation_no_truncate
      BEFORE TRUNCATE ON trade_commerce_profile_observation
      FOR EACH STATEMENT EXECUTE FUNCTION trade_commerce_profile_observation_guard();`)

    this.addSql(`CREATE TABLE trade_native_commitment_classification (
      classification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      resource_type text NOT NULL CHECK (resource_type IN ('cart', 'quotation', 'draft_order', 'order')),
      resource_id text NOT NULL CHECK (length(btrim(resource_id)) BETWEEN 1 AND 200),
      origin text NOT NULL CHECK (origin IN ('DIRECT', 'CONVERTED', 'REPLACEMENT')),
      parent_classification_id uuid REFERENCES trade_native_commitment_classification (classification_id),
      lineage_relation text CHECK (lineage_relation IN ('CONVERTED_FROM', 'REPLACES')),
      digital_estate_id text NOT NULL,
      tenant_id text NOT NULL,
      trade_engine_instance_id text NOT NULL,
      market_id text NOT NULL,
      commerce_model text NOT NULL CHECK (commerce_model IN ('B2B', 'B2C')),
      commerce_profile_id uuid NOT NULL,
      profile_revision integer NOT NULL CHECK (profile_revision >= 1),
      profile_attestation_id uuid NOT NULL REFERENCES trade_commerce_profile_observation (attestation_id),
      attribution_id uuid NOT NULL REFERENCES trade_commitment_attribution (attribution_id),
      seller_binding_id uuid NOT NULL,
      seller_binding_version integer NOT NULL CHECK (seller_binding_version >= 1),
      seller_context_id uuid NOT NULL,
      buyer_account_model text NOT NULL CHECK (buyer_account_model IN ('BUYER_ORGANISATION', 'CONSUMER')),
      buyer_organisation_id text CHECK (buyer_organisation_id ~ '^(buyerorg|b2borg)_[a-z0-9]+$'
        AND length(buyer_organisation_id) BETWEEN 10 AND 63),
      buyer_membership_id text CHECK (buyer_membership_id ~ '^(buyermem|b2bmem)_[a-z0-9]+$'
        AND length(buyer_membership_id) BETWEEN 10 AND 63),
      machine_mandate_reference text CHECK (length(btrim(machine_mandate_reference)) BETWEEN 1 AND 200),
      consumer_reference text CHECK (length(btrim(consumer_reference)) BETWEEN 1 AND 200),
      buyer_context_id uuid,
      status text NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'QUARANTINED')),
      revision integer NOT NULL CHECK (revision >= 1),
      classified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      evidence_references text[] NOT NULL CHECK (
        cardinality(evidence_references) >= 1 AND array_position(evidence_references, NULL) IS NULL),
      correlation_id uuid NOT NULL,
      CHECK (CASE origin
        WHEN 'DIRECT' THEN parent_classification_id IS NULL AND lineage_relation IS NULL
        WHEN 'CONVERTED' THEN parent_classification_id IS NOT NULL AND lineage_relation = 'CONVERTED_FROM'
        ELSE parent_classification_id IS NOT NULL AND lineage_relation = 'REPLACES' END),
      CHECK (CASE commerce_model
        WHEN 'B2B' THEN buyer_account_model = 'BUYER_ORGANISATION' AND buyer_organisation_id IS NOT NULL
             AND buyer_context_id IS NOT NULL AND consumer_reference IS NULL
             AND ((buyer_membership_id IS NULL) <> (machine_mandate_reference IS NULL))
        ELSE buyer_account_model = 'CONSUMER' AND consumer_reference IS NOT NULL
             AND buyer_organisation_id IS NULL AND buyer_membership_id IS NULL
             AND machine_mandate_reference IS NULL AND buyer_context_id IS NULL END));
    CREATE UNIQUE INDEX trade_native_commitment_classification_active
      ON trade_native_commitment_classification (resource_type, resource_id) WHERE status = 'ACTIVE';
    CREATE UNIQUE INDEX trade_native_commitment_classification_converted_once
      ON trade_native_commitment_classification (parent_classification_id) WHERE origin = 'CONVERTED';
    CREATE INDEX trade_native_commitment_classification_resource
      ON trade_native_commitment_classification (resource_type, resource_id, classified_at DESC);`)

    this
      .addSql(`CREATE FUNCTION trade_native_commitment_classification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE o trade_commerce_profile_observation%ROWTYPE; a trade_commitment_attribution%ROWTYPE;
            p trade_native_commitment_classification%ROWTYPE;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Decision 8: native commitment classifications are never deleted';
      END IF;
      IF TG_OP = 'UPDATE' THEN
        -- The one transition: ACTIVE to SUPERSEDED or QUARANTINED, revision + 1.
        IF OLD.status = 'ACTIVE' AND NEW.status IN ('SUPERSEDED', 'QUARANTINED')
           AND NEW.revision = OLD.revision + 1
           AND (to_jsonb(NEW) - 'status' - 'revision') = (to_jsonb(OLD) - 'status' - 'revision') THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Decision 8 denied: a classification never changes after creation';
      END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended(
        'trade-classification/' || NEW.resource_type || '/' || NEW.resource_id, 0));
      IF NEW.status <> 'ACTIVE' OR NEW.revision <> 1 THEN
        RAISE EXCEPTION 'Decision 8 denied: a classification starts ACTIVE at revision 1';
      END IF;
      IF NEW.resource_type = 'quotation' THEN
        RAISE EXCEPTION 'Decision 8 denied: a quotation has no seller attribution to classify against';
      END IF;
      NEW.classified_at := clock_timestamp();

      SELECT * INTO o FROM trade_commerce_profile_observation WHERE attestation_id = NEW.profile_attestation_id;
      IF o.observation_id IS NULL OR o.outcome <> 'ATTESTED' OR o.expires_at <= NEW.classified_at
         OR o.digital_estate_id <> NEW.digital_estate_id OR o.tenant_id <> NEW.tenant_id
         OR o.engine_instance_id <> NEW.trade_engine_instance_id OR o.market_id <> NEW.market_id
         OR o.commerce_profile_id <> NEW.commerce_profile_id OR o.profile_revision <> NEW.profile_revision
         OR o.commerce_model <> NEW.commerce_model THEN
        RAISE EXCEPTION 'Decision 8 denied: the classification does not match a live CP commerce profile attestation';
      END IF;

      SELECT * INTO a FROM trade_commitment_attribution WHERE attribution_id = NEW.attribution_id;
      IF a.attribution_id IS NULL OR a.subject_type <> NEW.resource_type OR a.subject_id <> NEW.resource_id
         OR a.tenant_id <> NEW.tenant_id OR a.engine_instance_id <> NEW.trade_engine_instance_id
         OR a.binding_id <> NEW.seller_binding_id OR a.binding_version <> NEW.seller_binding_version
         OR a.context_id <> NEW.seller_context_id
         -- Only the resource's current attribution, never a superseded one.
         OR EXISTS (SELECT 1 FROM trade_commitment_attribution later
              WHERE later.subject_type = a.subject_type AND later.subject_id = a.subject_id
                AND (later.recorded_at, later.attribution_id) > (a.recorded_at, a.attribution_id)) THEN
        RAISE EXCEPTION 'Decision 8 denied: the classification does not match the resource''s current seller attribution';
      END IF;

      IF NEW.origin = 'REPLACEMENT' THEN
        SELECT * INTO p FROM trade_native_commitment_classification
          WHERE classification_id = NEW.parent_classification_id;
        IF p.classification_id IS NULL OR p.resource_type <> NEW.resource_type OR p.resource_id <> NEW.resource_id
           OR p.status = 'ACTIVE' THEN
          RAISE EXCEPTION 'Decision 8 denied: a replacement names a retired classification of the same resource';
        END IF;
      ELSIF EXISTS (SELECT 1 FROM trade_native_commitment_classification
             WHERE resource_type = NEW.resource_type AND resource_id = NEW.resource_id) THEN
        RAISE EXCEPTION 'Decision 8 denied: the resource is already classified; a change is a governed replacement';
      END IF;
      IF NEW.origin = 'CONVERTED' THEN
        SELECT * INTO p FROM trade_native_commitment_classification
          WHERE classification_id = NEW.parent_classification_id;
        IF p.classification_id IS NULL OR p.status = 'QUARANTINED'
           OR (p.resource_type = NEW.resource_type AND p.resource_id = NEW.resource_id)
           OR p.digital_estate_id <> NEW.digital_estate_id OR p.tenant_id <> NEW.tenant_id
           OR p.trade_engine_instance_id <> NEW.trade_engine_instance_id OR p.market_id <> NEW.market_id
           OR p.commerce_model <> NEW.commerce_model OR p.buyer_account_model <> NEW.buyer_account_model
           OR p.buyer_organisation_id IS DISTINCT FROM NEW.buyer_organisation_id
           OR p.consumer_reference IS DISTINCT FROM NEW.consumer_reference THEN
          RAISE EXCEPTION 'Decision 8 denied: a conversion continues its parent commitment unchanged';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trade_native_commitment_classification_guard
      BEFORE INSERT OR UPDATE OR DELETE ON trade_native_commitment_classification
      FOR EACH ROW EXECUTE FUNCTION trade_native_commitment_classification_guard();
    CREATE TRIGGER trade_native_commitment_classification_no_truncate
      BEFORE TRUNCATE ON trade_native_commitment_classification
      FOR EACH STATEMENT EXECUTE FUNCTION trade_commerce_profile_observation_guard();`)
  }

  async down(): Promise<void> {
    // Dropping the classification history would erase the evidence the commit fence relies on.
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'Decision 8 classification rollback requires reviewed history preservation'; END $$;`,
    )
  }
}
