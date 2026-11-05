import { describe, expect, it, vi } from "vitest"
import { generateKeyPairSync, sign } from "node:crypto"
import {
  REQUIRED_CHARGES,
  issueGovernedCartCharges,
  type GovernedChargeIssuer,
  signedChargeBytes,
  verifyGovernedChargeEvidence,
  type ChargeEvidence,
  type ChargeIssuerMandate,
} from "../src/baobab/b2b/governed-cart-charge-issuer"

const UUID = "12345678-1234-4234-8234-123456789012"
const now = Date.parse("2026-11-05T08:00:00Z")
const keys = generateKeyPairSync("ed25519")
const evidence = (): ChargeEvidence => ({
  issuerId: "regulated-price-issuer-za",
  attestationId: UUID,
  tenantId: "tn_za1",
  cartId: "cart_testing123",
  marketId: "zuribeans_za",
  sellerLegalEntityId: "LE-ZA-100",
  currency: "ZAR",
  resourceVersion: now,
  cartUpdatedAtExact: "2026-11-05T08:00:00.000000Z",
  evaluatedAt: "2026-11-05T07:59:40Z",
  expiresAt: "2026-11-05T08:04:40Z",
  policyReference: "cp:policy:za-price-v3",
  charges: REQUIRED_CHARGES.map((kind) => ({
    kind,
    resolution:
      kind === "TAX" || kind === "FREIGHT" ? ("CHARGED" as const) : ("NOT_APPLICABLE" as const),
    amountMinor: kind === "TAX" ? "15000" : kind === "FREIGHT" ? "2500" : "0",
    sourceReference: "provider:20261105:" + kind,
    zeroReason:
      kind === "TAX" || kind === "FREIGHT" ? null : ("NOT_APPLICABLE_PER_INCOTERM" as const),
  })),
})
const cp = (e: ChargeEvidence): Promise<ChargeIssuerMandate> =>
  Promise.resolve({
    outcome: "AUTHORIZED",
    cpDecisionId: UUID,
    issuerId: e.issuerId,
    tenantId: e.tenantId,
    marketId: e.marketId,
    sellerLegalEntityId: e.sellerLegalEntityId,
    policyReference: e.policyReference,
    expiresAt: "2026-11-05T08:04:50Z",
  })
const signed = (e: ChargeEvidence) => ({
  evidence: e,
  signature: sign(null, signedChargeBytes(e), keys.privateKey).toString("base64url"),
})
const denied = async (e: ChargeEvidence, mandate = cp) =>
  expect(verifyGovernedChargeEvidence(signed(e), mandate, keys.publicKey, now)).rejects.toThrow(
    "GOVERNED_FINAL_CHARGE_ISSUER_NOT_PROVEN",
  )

describe("DEV-07 genuine source-owned final charge issuer (source-only)", () => {
  it("requires cryptographic provider evidence AND a current exact CP decision", async () => {
    const receipt = await verifyGovernedChargeEvidence(signed(evidence()), cp, keys.publicKey, now)
    expect(receipt.decisionId).toBe(UUID)
    expect(receipt.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.evidence.charges).toHaveLength(7)
  })
  it("uses the real public key and bound CP adapter for a fractional-second cart version", async () => {
    const e = evidence()
    e.resourceVersion = now + 182
    e.cartUpdatedAtExact = "2026-11-05T08:00:00.182396Z"
    const queries: string[] = []
    const release = vi.fn()
    const issuer: GovernedChargeIssuer = {
      publicKey: keys.publicKey,
      obtainFromIssuer: async () => signed(e),
      async verifyCpIssuer(value) {
        expect(this.publicKey).toBe(keys.publicKey)
        return cp(value)
      },
      db: {
        connect: async () => ({
          query: async (sql) => {
            queries.push(sql)
            if (sql.includes("FROM cart ")) {
              return {
                rows: [
                  {
                    currency_code: "zar",
                    completed_at: null,
                    updated_at: new Date(e.resourceVersion),
                    exact_updated_at: e.cartUpdatedAtExact,
                  },
                ],
                rowCount: 1,
              }
            }
            return { rows: [], rowCount: 0 }
          },
          release,
        }),
      },
    }
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 1000)
    try {
      await issueGovernedCartCharges(issuer, e.cartId)
      expect(queries.filter((sql) => sql.startsWith("INSERT"))).toHaveLength(14)
      expect(queries.at(-1)).toBe("COMMIT")
      expect(release).toHaveBeenCalledOnce()
    } finally {
      clock.mockRestore()
    }
  })

  it("refuses missing or duplicated tax, freight, duty, or other classes", async () => {
    for (const kind of REQUIRED_CHARGES) {
      const absent = evidence()
      absent.charges = absent.charges.filter((line) => line.kind !== kind)
      await denied(absent)
      const duplicate = evidence()
      duplicate.charges[6] = duplicate.charges[0]
      await denied(duplicate)
    }
  })
  it("refuses guessed zero and nonzero charge with a zero reason", async () => {
    const missing = evidence()
    missing.charges[2].zeroReason = null
    await denied(missing)
    const nonzero = evidence()
    nonzero.charges[2].amountMinor = "3"
    await denied(nonzero)
  })
  it("refuses false provider signatures, expired mandate and wrong seller", async () => {
    const envelope = signed(evidence())
    envelope.signature = "A".repeat(86)
    await expect(verifyGovernedChargeEvidence(envelope, cp, keys.publicKey, now)).rejects.toThrow(
      "GOVERNED_FINAL_CHARGE_ISSUER_NOT_PROVEN",
    )
    await denied(evidence(), async (e) => ({
      ...(await cp(e)),
      expiresAt: "2026-11-05T07:59:00Z",
    }))
    await denied(evidence(), async (e) => ({
      ...(await cp(e)),
      sellerLegalEntityId: "LE-WRONG",
    }))
  })
  it("refuses changed exact source timestamp and untrusted issuer scope", async () => {
    const invalid = evidence()
    invalid.cartUpdatedAtExact = "yesterday"
    await denied(invalid)
    const noKey = evidence()
    noKey.issuerId = ""
    await denied(noKey)
  })
})
