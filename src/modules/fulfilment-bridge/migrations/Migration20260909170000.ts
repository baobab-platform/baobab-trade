import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260909170000 extends Migration {
  async up(): Promise<void> {
    // A globally-unique idempotency_key meant two different fulfilments could never legitimately
    // reuse the same key literal — and worse, if one ever did (e.g. a caller convention that
    // doesn't embed the fulfilment reference), transition() would silently treat the OTHER
    // fulfilment's prior transition as "this one already happened" and no-op instead of applying
    // it. Every existing row already satisfies the weaker composite uniqueness, so no backfill
    // is needed — this only widens what the constraint allows.
    this.addSql('drop index if exists "IDX_fulfilment_transition_idempotency";')
    this.addSql(
      `create unique index if not exists "IDX_fulfilment_transition_idempotency" on "fulfilment_status_transition" ("fulfilment_id", "idempotency_key") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    // Narrowing this back to a global unique index could fail outright if any two fulfilments
    // have since legitimately reused the same idempotency key literal — which this migration's
    // whole point is to permit. Leaving the wider, composite constraint in place on rollback is
    // safe; re-narrowing it is not.
  }
}
