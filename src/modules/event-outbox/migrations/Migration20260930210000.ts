import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-018 §8.5 (T-COMPAT-03): retires the Thamani ERP projection
 * commands. The com.nabhold.commerce.thamani-*.projection-requested.v1 types
 * name a Digital Estate, encode their consumer and behave as commands, so
 * Trade stops emitting them. When Thamani resumes, it consumes canonical
 * business facts filtered by tenant and estate.
 *
 * Migration history stays immutable: Migration20260909110000 and
 * Migration20260909190000 are not edited. This forward migration re-creates
 * baobab_enqueue_thamani_erp_projection() with the same erp_projection
 * invariants (published projections are immutable; Thamani rows stay inside
 * the Thamani legal entity, Digital Estate and Market/legal-seller pairing)
 * and without the outbox insert. The trigger itself is unchanged.
 *
 * Outbox rows, per ADR-SHARED-018 §3.6:
 * - PUBLISHED rows are historical facts and are not touched.
 * - Unpublished rows (PENDING, RETRY, PUBLISHING) of a retired Thamani
 *   command have no canonical equivalent to map to, because they are
 *   commands, not facts. They are moved to DEAD_LETTER with
 *   last_error_code RETIRED_ADR_SHARED_018. They are never deleted, so the
 *   record of what was queued survives, and never published.
 */
export class Migration20260930210000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create or replace function baobab_enqueue_thamani_erp_projection() returns trigger as $$
      declare
        expected_seller text;
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
        if new.kind not in ('PRODUCT', 'SUPPLIER', 'WAREHOUSE', 'ORDER', 'SHIPMENT', 'PAYMENT', 'RETURN_REFUND', 'CREDIT_LINE') then
          raise exception 'Unsupported Thamani ERP projection kind %', new.kind;
        end if;
        return new;
      end;
      $$ language plpgsql;
    `)
    this.addSql(`
      update "event_outbox"
      set "status" = 'DEAD_LETTER',
          "last_error_code" = 'RETIRED_ADR_SHARED_018',
          "lease_expires_at" = null,
          "updated_at" = now()
      where "event_type" like 'com.nabhold.commerce.thamani-%'
        and "status" in ('PENDING', 'RETRY', 'PUBLISHING')
        and "deleted_at" is null;
    `)
  }

  async down(): Promise<void> {
    // Intentionally a no-op. Restoring the retired commands would reintroduce
    // estate-named command events that ADR-SHARED-018 §8.5 forbids, and
    // dead-lettered rows must not be re-queued. Rolling back means restoring
    // Migration20260909190000's function body in a new forward migration
    // with an explicit architecture decision.
  }
}
