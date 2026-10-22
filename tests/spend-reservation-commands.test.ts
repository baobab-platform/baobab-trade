import { describe, expect, it } from "vitest"
import {
  MAX_RESERVATION_HOLD_MS,
  PostgresSpendReservationCommands,
  refusalFor,
  type SubmitCommand,
} from "../src/baobab/b2b/spend-reservation-commands"
import type { PgPool } from "../src/baobab/orders/postgres-governed-binding-persistence"

/**
 * ADR-SHARED-042 Decision 5 / CAA-06. The ledger behaviour itself runs on
 * PostgreSQL 17 (src/scripts/regression-spend-reservation-commands.ts); these
 * cover what fails before or after the database.
 */
const submission = (change: Partial<SubmitCommand> = {}): SubmitCommand => ({
  idempotencyKey: "submit.0000000001",
  tenantId: "tn_test",
  organisationId: "b2borg_buyer000001",
  membershipId: "b2bmem_alice000001",
  actorPrincipalId: "019a0915-a8c0-7000-8000-00000000a011",
  marketKey: "ZA",
  currencyCode: "ZAR",
  agreementReference: null,
  transactionDigest: `sha256:${"a".repeat(64)}`,
  resourceVersion: 1,
  amountMinor: 1_000n,
  expiresAt: new Date(Date.now() + 60_000),
  ...change,
})
const unreachable: PgPool = {
  connect: async () => {
    throw new Error("connection refused")
  },
}

describe("spend reservation commands", () => {
  const commands = new PostgresSpendReservationCommands(unreachable)

  it("refuses a malformed submission before touching the database", () => {
    for (const change of [
      { idempotencyKey: "short" },
      { currencyCode: "zar" },
      { transactionDigest: "md5:abc" },
      { resourceVersion: 0 },
      { resourceVersion: 1.5 },
      { amountMinor: 0n },
      { amountMinor: -1n },
      { expiresAt: new Date(Date.now() - 1) },
      { expiresAt: new Date(Date.now() + MAX_RESERVATION_HOLD_MS + 60_000) },
      { membershipId: "" },
    ]) {
      expect(() => commands.submit(submission(change))).toThrow(TypeError)
    }
  })

  it("is UNAVAILABLE, never success, when the database cannot be reached", async () => {
    expect(await commands.submit(submission())).toEqual({
      outcome: "REFUSED",
      reason: "SOURCE_UNAVAILABLE",
    })
  })

  it("maps the ledger's refusals to closed reasons and anything else to UNAVAILABLE", () => {
    expect(refusalFor(new Error("b2b_spend_ledger_entry: insufficient budget capacity"))).toBe(
      "SPEND_LIMIT_EXCEEDED",
    )
    for (const message of [
      "b2b_spend_ledger_entry: the budget is not in effect at this revision",
      "b2b_spend_ledger_entry: an expired or closed reservation never authorises commitment",
      "b2b_spend_reservation: COMMITTED is terminal",
    ]) {
      expect(refusalFor(new Error(message))).toBe("CONTEXT_NOT_USABLE")
    }
    expect(refusalFor(new Error("canceling statement due to lock timeout"))).toBe(
      "SOURCE_UNAVAILABLE",
    )
    expect(refusalFor("not an error")).toBe("SOURCE_UNAVAILABLE")
  })
})
