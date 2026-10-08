import { describe, expect, it, vi } from "vitest"
import { REQUIRED_CORE_MODULE_PROBES, verifyCoreModules } from "../src/baobab/health/core-modules"

describe("required Medusa core modules", () => {
  it("defines one probe for every Gate 1 capability", () => {
    expect(REQUIRED_CORE_MODULE_PROBES.map(({ capability }) => capability)).toEqual([
      "Product",
      "Pricing",
      "Customer",
      "Cart",
      "Order",
      "Inventory",
      "Stock Location",
      "Region",
      "Sales Channel",
      "Currency",
      "Payment",
      "Fulfillment",
      "Tax",
      "Auth",
      "API Key",
      "Store",
    ])
  })

  it("resolves and reads every required module", async () => {
    const services = new Map(
      REQUIRED_CORE_MODULE_PROBES.map(({ registration, readMethod }) => [
        registration,
        { [readMethod]: vi.fn().mockResolvedValue([]) },
      ]),
    )
    const container = {
      resolve: vi.fn((registration: string) => services.get(registration)),
    }

    const results = await verifyCoreModules(container)

    expect(results).toHaveLength(16)
    expect(container.resolve).toHaveBeenCalledTimes(16)
    for (const probe of REQUIRED_CORE_MODULE_PROBES) {
      expect(services.get(probe.registration)?.[probe.readMethod]).toHaveBeenCalledWith(
        {},
        { take: 1 },
      )
    }
  })

  it("fails closed when a required read capability is absent", async () => {
    const container = { resolve: vi.fn(() => ({})) }

    await expect(verifyCoreModules(container)).rejects.toThrow(
      "Product module 'product' does not expose listProducts",
    )
  })
})
