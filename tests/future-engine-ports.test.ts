import { describe, expect, it } from "vitest"
import { NATIVE_CAPABILITY_BINDINGS } from "../src/baobab/ports"

describe("future engine ports", () => {
  it("keeps native capabilities bound", () =>
    expect(NATIVE_CAPABILITY_BINDINGS).toMatchObject({
      orders: "MEDUSA_NATIVE",
      inventory: "MEDUSA_NATIVE",
      pricing: "MEDUSA_NATIVE",
      payments: "MEDUSA_NATIVE",
      fulfilment: "MEDUSA_NATIVE",
      tradeCompliance: "PROJECTED_ADAPTER",
      ledgerEvidence: "DISABLED_BOUNDARY",
    }))
})
