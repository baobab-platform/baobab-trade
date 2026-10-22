import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import budget from "../src/baobab/contracts/shared/contracts/trade/v2/buyer-spend-budget.schema.json"

/**
 * ADR-SHARED-042 section 14, Decision 5: the Trade ledger (Migration20261022150000)
 * speaks exactly the pinned Shared vocabulary. This proves the boundary only.
 */
const migration = readFileSync("src/modules/b2b/migrations/Migration20261022150000.ts", "utf8")
const checked = (column: string) => {
  const match = migration.match(new RegExp(`"${column}" in\\s*\\(([^)]*)\\)`))
  if (!match) throw new Error(`no check constraint for ${column}`)
  return [...match[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort()
}
const sorted = (values: string[]) => [...values].sort()
const defs = budget.$defs

describe("buyer spend budget contract conformance", () => {
  it("uses the Shared scopes, period kinds, ledger kinds and release reasons", () => {
    expect(checked("scope")).toEqual(sorted(defs.budgetScope.enum))
    expect(checked("period_kind")).toEqual(sorted(defs.periodKind.enum))
    expect(checked("entry_kind")).toEqual(sorted(defs.ledgerEntryKind.enum))
    expect(checked("release_reason")).toEqual(sorted(defs.releaseReason.enum))
    expect(checked("status")).toEqual(sorted(defs.BuyerSpendBudgetPolicy.properties.status.enum))
  })

  it("uses the Shared identifier prefixes and idempotency key format", () => {
    expect(defs.budgetPolicyId.pattern).toMatch(/^\^b2bbud_/)
    expect(defs.reservationId.pattern).toMatch(/^\^b2bres_/)
    expect(defs.ledgerEntryId.pattern).toMatch(/^\^b2bled_/)
    expect(migration).toContain(`'${defs.SpendLedgerEntry.properties.idempotency_key.pattern}'`)
  })
})
