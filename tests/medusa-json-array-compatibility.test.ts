import { describe, expect, it } from "vitest"
import { medusaJsonArray, readMedusaJsonArray } from "../src/baobab/medusa/json-array"

describe("Medusa 2.21 generated JSON-column array compatibility", () => {
  it("preserves the exact JSON array shape for existing PostgreSQL jsonb records", () => {
    const data = ["UG", "ZA"]
    const encoded = medusaJsonArray(data)
    expect(Array.isArray(encoded)).toBe(true)
    expect(JSON.stringify(encoded)).toBe(JSON.stringify(data))
    expect(readMedusaJsonArray<string>(encoded)).toEqual(data)
  })

  it("rejects replacing the existing array-valued policy with a generic object", () => {
    expect(() => medusaJsonArray({ "0": "UG" } as never)).toThrow("real array")
    expect(() => readMedusaJsonArray<string>({ "0": "ZA" })).toThrow("array contract")
    expect(() => readMedusaJsonArray<string>(null)).toThrow("array contract")
  })
})
