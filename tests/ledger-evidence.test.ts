import { describe, expect, it } from "vitest"
import { DisabledLedgerEvidenceAdapter, type LedgerEvidence } from "../src/baobab/ledger"

const evidence: LedgerEvidence = {
  evidenceId: "evidence-18",
  evidenceType: "PAYMENT_OBSERVED",
  canonicalEntityId: "canonical:payment:1",
  commerceReference: "payment-1",
  occurredAt: new Date().toISOString(),
  idempotencyKey: "ledger-18",
  correlationId: "corr-18",
  evidence: {},
}

describe("LedgerEvidencePort contract (DisabledLedgerEvidenceAdapter)", () => {
  it("rejects monetary evidence with no currency", async () => {
    await expect(
      new DisabledLedgerEvidenceAdapter().append({ ...evidence, amountMinor: 100 }),
    ).rejects.toThrow(/currency/)
  })

  it("accepts monetary evidence that carries a currency, but never grants ledger authority", async () => {
    const result = await new DisabledLedgerEvidenceAdapter().append({
      ...evidence,
      amountMinor: 100,
      currencyCode: "UGX",
    })
    expect(result).toEqual({ evidenceId: evidence.evidenceId, accepted: false })
  })

  it("never requires a currency for non-monetary evidence, but still never accepts", async () => {
    const result = await new DisabledLedgerEvidenceAdapter().append(evidence)
    expect(result).toEqual({ evidenceId: evidence.evidenceId, accepted: false })
  })
})
