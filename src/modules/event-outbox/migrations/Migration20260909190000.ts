import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Gate 17 (Store Credit) adds a CREDIT_LINE ERP projection kind. The
 * Gate 16 trigger function (Migration20260909110000) maps `erp_projection.kind`
 * to a canonical event type via a hardcoded `case` statement with no
 * fallback, so an unrecognised kind raises `Unsupported Thamani ERP
 * projection kind %` rather than silently doing nothing — this migration
 * replaces the function with the same body plus one more `when` branch.
 * `create or replace function` swaps the whole body atomically; no down()
 * migration exists in this file because a rollback would mean restoring
 * the Gate 16 body verbatim, which Migration20260909110000's own down()
 * already does by dropping the function entirely.
 */
export class Migration20260909190000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create or replace function baobab_enqueue_thamani_erp_projection() returns trigger as $$
      declare
        expected_seller text;
        event_type text;
        event_id text;
        outbox_id text;
        event_envelope jsonb;
        existing_digest text;
      begin
        if new.source_idempotency_key not like 'thamani:erp:%' then
          return new;
        end if;
        if tg_op = 'UPDATE' and (
          new.source_idempotency_key is distinct from old.source_idempotency_key or
          new.kind is distinct from old.kind or
          new.canonical_entity_id is distinct from old.canonical_entity_id or
          new.commerce_reference is distinct from old.commerce_reference or
          new.market_key is distinct from old.market_key or
          new.legal_seller_key is distinct from old.legal_seller_key or
          new.owner_legal_entity_id is distinct from old.owner_legal_entity_id or
          new.digital_estate is distinct from old.digital_estate or
          new.payload is distinct from old.payload or
          new.command_digest is distinct from old.command_digest or
          new.correlation_id is distinct from old.correlation_id
        ) then
          raise exception 'Published Thamani projection identity and payload are immutable';
        end if;
        if new.owner_legal_entity_id is distinct from 'canonical:legal-entity:thamani' or new.digital_estate is distinct from 'estate:thamani-b2c' then
          raise exception 'Thamani projection belongs to another legal entity or Digital Estate';
        end if;

        expected_seller := case new.market_key
          when 'thamani_ug' then 'thamani-uganda'
          when 'thamani_za' then 'thamani-south-africa'
          else null
        end;
        if expected_seller is null or new.legal_seller_key <> expected_seller then
          raise exception 'Thamani projection crosses its Market/legal-seller boundary';
        end if;

        event_type := case new.kind
          when 'PRODUCT' then 'com.nabhold.commerce.thamani-product.projection-requested.v1'
          when 'SUPPLIER' then 'com.nabhold.commerce.thamani-supplier.projection-requested.v1'
          when 'WAREHOUSE' then 'com.nabhold.commerce.thamani-warehouse.projection-requested.v1'
          when 'ORDER' then 'com.nabhold.commerce.thamani-order.projection-requested.v1'
          when 'SHIPMENT' then 'com.nabhold.commerce.thamani-shipment.projection-requested.v1'
          when 'PAYMENT' then 'com.nabhold.commerce.thamani-payment.projection-requested.v1'
          when 'RETURN_REFUND' then 'com.nabhold.commerce.thamani-return-refund.projection-requested.v1'
          when 'CREDIT_LINE' then 'com.nabhold.commerce.thamani-credit-line.projection-requested.v1'
          else null
        end;
        if event_type is null then raise exception 'Unsupported Thamani ERP projection kind %', new.kind; end if;

        event_id := substring(md5('thamani:event:' || new.source_idempotency_key), 1, 8) || '-' ||
          substring(md5('thamani:event:' || new.source_idempotency_key), 9, 4) || '-4' ||
          substring(md5('thamani:event:' || new.source_idempotency_key), 14, 3) || '-8' ||
          substring(md5('thamani:event:' || new.source_idempotency_key), 18, 3) || '-' ||
          substring(md5('thamani:event:' || new.source_idempotency_key), 21, 12);
        outbox_id := 'evtout_' || md5('thamani:outbox:' || new.source_idempotency_key);
        event_envelope := jsonb_build_object(
          'specversion', '1.0', 'id', event_id, 'type', event_type,
          'source', 'https://engines.nabhold.com/baobab-trade',
          'subject', 'thamani/' || lower(new.kind) || '/' || new.canonical_entity_id,
          'time', to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'datacontenttype', 'application/json',
          'dataschema', 'https://contracts.nabhold.com/commerce/thamani/' || lower(new.kind) || '/projection-requested/v1',
          'correlationid', new.correlation_id, 'causationid', new.id,
          'idempotencykey', 'thamani:event:' || new.source_idempotency_key,
          'baobabscope', 'tenant', 'tenantid', 'tenant-thamani',
          'data', jsonb_build_object(
            'owner_legal_entity_id', 'canonical:legal-entity:thamani', 'digital_estate', 'estate:thamani-b2c',
            'market_key', new.market_key, 'legal_seller_key', new.legal_seller_key,
            'canonical_entity_id', new.canonical_entity_id,
            'commerce_reference', new.commerce_reference, 'projection_kind', new.kind,
            'projection_status', 'PENDING', 'source_version', coalesce((new.payload->>'source_version')::integer, 1)
          )
        );
        insert into event_outbox (
          id, event_id, event_type, subject, tenant_id, owner_legal_entity_id,
          digital_estate, market_key, correlation_id, causation_id,
          idempotency_key, envelope, envelope_digest, status, attempt_count,
          next_attempt_at, created_at, updated_at
        ) values (
          outbox_id, event_id, event_type, event_envelope->>'subject', 'tenant-thamani',
          'canonical:legal-entity:thamani', 'estate:thamani-b2c', new.market_key, new.correlation_id, new.id,
          'thamani:event:' || new.source_idempotency_key, event_envelope,
          md5(event_envelope::text), 'PENDING', 0, now(), now(), now()
        ) on conflict (idempotency_key) where deleted_at is null do nothing;
        select envelope_digest into existing_digest from event_outbox
          where idempotency_key = 'thamani:event:' || new.source_idempotency_key
          and deleted_at is null;
        if existing_digest is distinct from md5(event_envelope::text) then
          raise exception 'Thamani event idempotency key reused with different envelope';
        end if;
        return new;
      end;
      $$ language plpgsql;
    `)
  }

  async down(): Promise<void> {
    // Intentionally a no-op — see the header comment.
  }
}
