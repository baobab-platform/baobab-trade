import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * ADR-SHARED-042 section 14 Decision 5 fix (Migration20261022150000): the
 * ledger trigger creates a period's balance row and a reservation's hold row
 * with INSERT ... ON CONFLICT (natural key) DO NOTHING, but each row's primary
 * key is derived from that same natural key. PostgreSQL treats only the named
 * arbiter index speculatively, so two transactions creating the same row
 * concurrently could collide on the primary key instead and raise a unique
 * violation: a correct, concurrent first reservation failed with an error
 * instead of a capacity answer. Both inserts now arbitrate on every unique
 * index (ON CONFLICT DO NOTHING); the row each one then locks and checks is
 * unchanged. Nothing else in the function changes, and the migration refuses
 * to apply unless it finds exactly the two clauses it replaces.
 */
const REPLACEMENTS: [string, string][] = [
  [`on conflict ("budget_policy_id", "period_starts_at") do nothing`, `on conflict do nothing`],
  [
    `on conflict ("reservation_id", "budget_policy_id", "period_starts_at") do nothing`,
    `on conflict do nothing`,
  ],
]

const rewrite = (pairs: [string, string][]) => `DO $$
DECLARE definition text := pg_get_functiondef('"b2b_spend_ledger_entry_apply"'::regproc);
BEGIN
${pairs
  .map(
    ([
      from,
      to,
    ]) => `  IF (length(definition) - length(replace(definition, ${literal(from)}, ''))) / length(${literal(from)}) <> 1 THEN
    RAISE EXCEPTION 'b2b_spend_ledger_entry_apply does not contain exactly one %', ${literal(from)};
  END IF;
  definition := replace(definition, ${literal(from)}, ${literal(to)});`,
  )
  .join("\n")}
  EXECUTE definition;
END $$;`

const literal = (text: string) => `'${text.replaceAll("'", "''")}'`

export class Migration20261022230000 extends Migration {
  async up(): Promise<void> {
    this.addSql(rewrite(REPLACEMENTS))
  }

  async down(): Promise<void> {
    // The targeted form is the defect; restoring it would reopen the race.
    this.addSql(
      `DO $$ BEGIN RAISE EXCEPTION 'Decision 5 ledger arbiter fix rollback requires a reviewed decision'; END $$;`,
    )
  }
}
