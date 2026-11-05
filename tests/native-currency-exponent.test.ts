import { describe, expect, it, vi } from "vitest"
import { readNativeCurrencyExponent } from "../src/baobab/b2b/native-currency-exponent"

const db = (rows: Record<string, unknown>[]) => ({
  query: vi.fn(async () => ({ rows, rowCount: rows.length })),
})

describe("DEV-07 actual Medusa Currency precision", () => {
  it("reads UGX=0 and ZAR=2 only from the persisted native module", async () => {
    for (const [code, digits] of [
      ["UGX", 0],
      ["ZAR", 2],
    ] as const) {
      const source = db([{ decimal_digits: digits }])
      expect(await readNativeCurrencyExponent(source, code)).toBe(digits)
      expect(source.query).toHaveBeenCalledWith(
        "SELECT decimal_digits FROM currency WHERE code=$1 FOR SHARE",
        [code.toLowerCase()],
      )
    }
  })
  it.each([
    { rows: [] },
    { rows: [{ decimal_digits: 2 }, { decimal_digits: 2 }] },
    { rows: [{ decimal_digits: null }] },
    { rows: [{ decimal_digits: 2.5 }] },
    { rows: [{ decimal_digits: "2.0" }] },
    { rows: [{ decimal_digits: -1 }] },
    { rows: [{ decimal_digits: 10 }] },
  ])("rejects unavailable, ambiguous or invalid native precision %j", async ({ rows }) => {
    await expect(readNativeCurrencyExponent(db(rows), "ZAR")).rejects.toThrow(
      "NATIVE_CURRENCY_METADATA_UNAVAILABLE",
    )
  })
  it("does not accept untrusted currency identifiers or SQL errors", async () => {
    const source = db([{ decimal_digits: 2 }])
    await expect(readNativeCurrencyExponent(source, "zar")).rejects.toThrow()
    expect(source.query).not.toHaveBeenCalled()
    await expect(
      readNativeCurrencyExponent(
        {
          query: async () => {
            throw new Error("private SQL failure")
          },
        },
        "ZAR",
      ),
    ).rejects.toThrow("NATIVE_CURRENCY_METADATA_UNAVAILABLE")
  })
})
