import { afterEach, describe, expect, it, vi } from "vitest"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import {
  signedChargeBytes,
  type ChargeEvidence,
} from "../src/baobab/b2b/governed-cart-charge-issuer"
import { buildFinalBuyerCommitmentValuation } from "../src/baobab/b2b/buyer-commitment-valuation"
import {
  readMedusaFinalCartPrice,
  type CurrentPriceIssuerAuthority,
} from "../src/baobab/b2b/medusa-final-cart-pricing"

const now = new Date("2026-11-05T02:00:15.000Z")
const updated = "2026-11-05T02:00:00.000Z"
const resourceVersion = Date.parse(updated)
const exact = "2026-11-05T02:00:00.000000Z"
const keys = generateKeyPairSync("ed25519")
const ATTESTATION = "beadbead-4444-4444-8444-beadbeadbead"
const CP_DECISION = "cafecafe-4444-4444-8444-cafecafecafe"
const kinds = [
  "TAX",
  "FREIGHT",
  "DUTY",
  "HANDLING",
  "INSURANCE",
  "SERVICE_CHARGE",
  "REFUNDABLE_DEPOSIT",
]
const amounts: Record<string, number> = {
  TAX: 108,
  FREIGHT: 80,
  DUTY: 10,
  HANDLING: 5,
  INSURANCE: 2,
  SERVICE_CHARGE: 3,
  REFUNDABLE_DEPOSIT: 0,
}
const bn = (numeric: string) => ({ numeric })
function fixture() {
  const cart = {
    id: "cart_governed_test01",
    currency_code: "UGX",
    customer_id: "customer_governed_test01",
    completed_at: null,
    updated_at: updated,
    item_subtotal: bn("1000"),
    shipping_subtotal: bn("80"),
    subtotal: bn("1080"),
    discount_subtotal: bn("20"),
    tax_total: bn("108"),
    item_tax_total: bn("100"),
    shipping_tax_total: bn("8"),
    total: bn("1168"),
    credit_line_total: bn("0"),
    gift_card_total: bn("0"),
    items: [
      {
        id: "cali_1",
        variant_id: "variant_1",
        quantity: 2,
        unit_price: bn("500"),
        subtotal: bn("1000"),
      },
    ],
    shipping_methods: [{ id: "casm_1", subtotal: bn("80") }],
  }

  const scoped = (): ChargeEvidence => ({
    issuerId: "registered-price-issuer-ug",
    attestationId: ATTESTATION,
    tenantId: "tn_test01",
    cartId: cart.id,
    marketId: "zuribeans_ug",
    sellerLegalEntityId: "LE-TEST-UG",
    currency: "UGX",
    resourceVersion,
    cartUpdatedAtExact: exact,
    evaluatedAt: "2026-11-05T02:00:10.000Z",
    expiresAt: "2026-11-05T02:01:00.000Z",
    policyReference: "cp:price:issuer-policy-v1",
    charges: kinds.map((kind) => ({
      kind: kind as ChargeEvidence["charges"][number]["kind"],
      resolution: (amounts[kind]
        ? "CHARGED"
        : "NOT_APPLICABLE") as ChargeEvidence["charges"][number]["resolution"],
      amountMinor: String(amounts[kind]),
      sourceReference: "source:" + kind + ":governed-v1",
      zeroReason: amounts[kind] ? null : "NOT_APPLICABLE_PER_INCOTERM",
    })),
  })
  const determinations = kinds.map((kind) => ({
    charge_kind: kind,
    resolution: amounts[kind] ? "CHARGED" : "NOT_APPLICABLE",
    amount_minor: String(amounts[kind]),
    currency: "UGX",
    source_reference: "source:" + kind + ":governed-v1",
    evaluated_at: "2026-11-05T02:00:10.000Z",
    expires_at: "2026-11-05T02:01:00.000Z",
    resource_version: String(resourceVersion),
    cart_updated_at_exact: exact,
    issuer_id: "registered-price-issuer-ug",
    attestation_id: ATTESTATION,
    cp_decision_id: CP_DECISION,
    source_digest: "",
    policy_reference: "cp:price:issuer-policy-v1",
    zero_reason: amounts[kind]
      ? (null as string | null)
      : ("NOT_APPLICABLE_PER_INCOTERM" as string | null),
    canonical_evidence: scoped(),
    issuer_signature: "",
    signer_key_fingerprint: "",
  }))
  const reissue = () => {
    const original = scoped()
    original.charges = determinations.map((row) => ({
      kind: row.charge_kind as ChargeEvidence["charges"][number]["kind"],
      resolution: row.resolution as ChargeEvidence["charges"][number]["resolution"],
      amountMinor: row.amount_minor,
      sourceReference: row.source_reference,
      zeroReason: row.zero_reason as ChargeEvidence["charges"][number]["zeroReason"],
    }))
    const bytes = signedChargeBytes(original)
    const digest = createHash("sha256").update(bytes).digest("hex")
    const signature = sign(null, bytes, keys.privateKey).toString("base64url")
    const keyHash = createHash("sha256")
      .update(
        keys.publicKey.export({
          type: "spki",
          format: "der",
        }),
      )
      .digest("hex")
    for (const row of determinations) {
      row.canonical_evidence = original
      row.source_digest = digest
      row.issuer_signature = signature
      row.signer_key_fingerprint = keyHash
    }
  }
  reissue()
  vi.stubEnv(
    "BAOBAB_NATIVE_PRICE_ISSUER_PUBLIC_KEY_PEM",
    keys.publicKey.export({ type: "spki", format: "pem" }) as string,
  )
  const queries: string[] = []
  const db = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql)
      if (sql.includes("FROM cart WHERE"))
        return {
          rows: [
            {
              id: cart.id,
              currency_code: "ugx",
              customer_id: cart.customer_id,
              completed_at: null,
              updated_at: exact,
            },
          ],
          rowCount: 1,
        }
      if (sql.includes("FROM cart_line_item WHERE"))
        return {
          rows: [{ id: "cali_1" }],
          rowCount: 1,
        }
      if (sql.includes("FROM cart_shipping_method WHERE"))
        return {
          rows: [{ id: "casm_1" }],
          rowCount: 1,
        }
      if (sql.includes("FROM trade_native_cart_charge_determination"))
        return {
          rows: determinations,
          rowCount: determinations.length,
        }
      if (
        sql.includes("cart_line_item_tax_line") ||
        sql.includes("cart_line_item_adjustment") ||
        sql.includes("cart_shipping_method_tax_line") ||
        sql.includes("cart_shipping_method_adjustment")
      ) {
        return { rows: [], rowCount: 0 }
      }
      throw new Error("unexpected native SQL")
    }),
  }
  const cartModule = {
    retrieveCart: vi.fn<(id: string, config: unknown, context: unknown) => Promise<typeof cart>>(
      async () => cart,
    ),
  }
  const scope = {
    db,
    transactionManager: { readonly: "fake unit manager, not native proof" },
    cartModule,
    cartId: cart.id,
    tenantId: "tn_test01",
    marketId: "zuribeans_ug",
    sellerLegalEntityId: "LE-TEST-UG",
    currencyExponent: 0,
    now,
    verifyCurrentIssuer: vi.fn<CurrentPriceIssuerAuthority>(async (check) => ({
      outcome: "AUTHORIZED" as const,
      issuerId: check.issuerId,
      decisionId: check.decisionId,
      tenantId: check.tenantId,
      marketId: check.marketId,
      sellerLegalEntityId: check.sellerLegalEntityId,
      policyReference: check.policyReference,
      sourceDigest: check.sourceDigest,
      expiresAt: "2026-11-05T02:00:50Z",
    })),
  }
  const determination = (kind: string) => {
    const row = determinations.find((fact) => fact.charge_kind === kind)
    if (!row) throw new Error(`Missing fixture determination for ${kind}`)
    return row
  }
  return { cart, determinations, determination, db, cartModule, scope, queries, reissue }
}

afterEach(() => vi.unstubAllEnvs())

describe("CAA-06b native Cart Module complete final obligation reader (unit-only)", () => {
  it("uses one native cart version and includes assessed duty, freight, tax and incidental costs", async () => {
    const h = fixture()
    const price = await readMedusaFinalCartPrice(h.scope)
    const valuation = buildFinalBuyerCommitmentValuation(price.valuation, now)
    expect(valuation.buyer_commitment_amount_minor).toBe(1188)
    expect(price.sourceFingerprint).toBe(price.valuation.transaction_digest)
    expect(price.valuation.resource_version).toBe(resourceVersion)
    expect(price.valuation.components.map((x) => x.component_kind)).toContain(
      "DUTY_AND_IMPORT_CHARGE",
    )
    expect(h.cartModule.retrieveCart).toHaveBeenCalledOnce()
    expect(h.cartModule.retrieveCart.mock.calls[0][2]).toEqual({
      transactionManager: h.scope.transactionManager,
    })
    expect(h.queries).toContainEqual(expect.stringContaining("FOR UPDATE"))
  })

  it.each([
    "TAX",
    "FREIGHT",
    "DUTY",
    "HANDLING",
    "INSURANCE",
    "SERVICE_CHARGE",
    "REFUNDABLE_DEPOSIT",
  ])("refuses missing %s determination without substituting zero", async (kind) => {
    const h = fixture()
    h.determinations.splice(
      h.determinations.findIndex((x) => x.charge_kind === kind),
      1,
    )
    await expect(readMedusaFinalCartPrice(h.scope)).rejects.toThrow(
      "NATIVE_FINAL_CART_CHARGE_DETERMINATION_MISSING",
    )
  })

  it.each(["TAX", "FREIGHT", "DUTY"])("refuses an unexplained zero for %s", async (kind) => {
    const h = fixture()
    const fact = h.determination(kind)
    fact.amount_minor = "0"
    await expect(readMedusaFinalCartPrice(h.scope)).rejects.toThrow(
      "NATIVE_FINAL_CART_UNJUSTIFIED_ZERO_OR_CHARGE",
    )
  })

  it("accepts a justified explicit zero but keeps the zero-valued component", async () => {
    const h = fixture()
    h.cart.shipping_subtotal.numeric = "0"
    h.cart.subtotal.numeric = "1000"
    h.cart.shipping_tax_total.numeric = "0"
    h.cart.tax_total.numeric = "100"
    h.cart.total.numeric = "1080"
    h.cart.shipping_methods[0].subtotal.numeric = "0"
    const freight = h.determination("FREIGHT")
    freight.amount_minor = "0"
    freight.resolution = "NOT_APPLICABLE"
    freight.zero_reason = "NOT_APPLICABLE_PER_INCOTERM"
    const tax = h.determination("TAX")
    tax.amount_minor = "100"
    h.reissue()
    const priced = await readMedusaFinalCartPrice(h.scope)
    expect(
      priced.valuation.components.find((x) => x.component_kind === "SHIPPING")?.amount_minor,
    ).toBe(0)
    expect(
      priced.valuation.components.find((x) => x.component_kind === "DUTY_AND_IMPORT_CHARGE")
        ?.amount_minor,
    ).toBe(10)
  })

  it.each(["subtotal", "tax_total", "shipping_subtotal", "total", "credit_line_total"])(
    "refuses missing native calculated %s instead of treating absent as zero",
    async (field) => {
      const h = fixture()
      Reflect.deleteProperty(h.cart, field)
      await expect(readMedusaFinalCartPrice(h.scope)).rejects.toThrow(
        "NATIVE_FINAL_CART_AMOUNT_UNAVAILABLE",
      )
    },
  )

  it("refuses stale charge provenance, foreign currency, or a changed quote version", async () => {
    for (const change of [
      (h: ReturnType<typeof fixture>) => {
        h.determinations[0].expires_at = "2026-11-05T01:59:59Z"
      },
      (h: ReturnType<typeof fixture>) => {
        h.determinations[0].currency = "ZAR"
      },
      (h: ReturnType<typeof fixture>) => {
        h.determinations[0].resource_version = "1"
      },
      (h: ReturnType<typeof fixture>) => {
        h.cart.updated_at = "2026-11-05T02:00:01.000Z"
      },
    ]) {
      const h = fixture()
      change(h)
      await expect(readMedusaFinalCartPrice(h.scope)).rejects.toThrow("NATIVE_FINAL_CART_")
    }
  })

  it("changes the transaction digest for same-total product substitution or different duty source", async () => {
    const first = fixture()
    const original = await readMedusaFinalCartPrice(first.scope)
    const replaced = fixture()
    replaced.cart.items[0].variant_id = "variant_replaced"
    const after = await readMedusaFinalCartPrice(replaced.scope)
    expect(after.sourceFingerprint).not.toBe(original.sourceFingerprint)
    const otherSource = fixture()
    otherSource.determination("DUTY").source_reference = "source:DUTY:other-rule-v2"
    otherSource.reissue()
    const withNewDuty = await readMedusaFinalCartPrice(otherSource.scope)
    expect(withNewDuty.sourceFingerprint).not.toBe(original.sourceFingerprint)
  })

  it("refuses an issuer revocation at commit despite a valid historical signature", async () => {
    const h = fixture()
    h.scope.verifyCurrentIssuer.mockImplementationOnce(async (check) => ({
      outcome: "DENIED" as const,
      issuerId: check.issuerId,
      decisionId: check.decisionId,
      tenantId: check.tenantId,
      marketId: check.marketId,
      sellerLegalEntityId: check.sellerLegalEntityId,
      policyReference: check.policyReference,
      sourceDigest: check.sourceDigest,
      expiresAt: "2026-11-05T02:00:50Z",
    }))
    await expect(readMedusaFinalCartPrice(h.scope)).rejects.toThrow(
      "NATIVE_FINAL_CART_ISSUER_CURRENT_AUTHORITY_DENIED",
    )
  })

  it("refuses changed native item quantities and shipping methods", async () => {
    const h = fixture()
    h.cart.items[0].quantity = 3
    await expect(readMedusaFinalCartPrice(h.scope)).rejects.toThrow(
      "NATIVE_FINAL_CART_ITEM_SUBTOTAL_INCONSISTENT",
    )
    const foreign = fixture()
    foreign.cart.shipping_methods[0].id = "casm_foreign"
    await expect(readMedusaFinalCartPrice(foreign.scope)).rejects.toThrow(
      "NATIVE_FINAL_CART_SHIPPING_SET_CHANGED",
    )
  })
})
