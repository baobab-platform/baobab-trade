import { describe, expect, it } from "vitest"
import { ZURIBEANS_CATALOGUE } from "../src/baobab/catalogue"
import { ZURIBEANS_INVENTORY_LOCATIONS } from "../src/baobab/inventory"
import {
  SIMULATION_ASSUMPTIONS,
  SIMULATION_BUYERS,
  SIMULATION_ORGANISATIONS,
  SIMULATION_SCENARIOS,
  SIMULATION_SUPPLIERS,
  assertSimulationDataset,
} from "../src/baobab/simulation"
describe("Gate 18 ZuriBeans simulation readiness", () => {
  it("validates all cross-domain references", () => expect(assertSimulationDataset).not.toThrow())
  it("contains ten products across the five requested commodity families", () => {
    expect(ZURIBEANS_CATALOGUE).toHaveLength(10)
    expect(new Set(ZURIBEANS_CATALOGUE.map((x) => x.attributes.kind))).toEqual(
      new Set(["COFFEE", "VANILLA", "COCOA", "TEA", "GINGER"]),
    )
  })
  it("covers Uganda, South Africa, parties and six warehouses", () => {
    expect(new Set(SIMULATION_SCENARIOS.flatMap((x) => [x.origin, x.destination]))).toEqual(
      new Set(["UG", "ZA"]),
    )
    expect(ZURIBEANS_INVENTORY_LOCATIONS).toHaveLength(6)
    expect(SIMULATION_ORGANISATIONS.length).toBeGreaterThan(1)
    expect(SIMULATION_BUYERS.length).toBe(SIMULATION_ORGANISATIONS.length)
    expect(SIMULATION_SUPPLIERS.length).toBeGreaterThan(1)
  })
  it("includes tax, tariff and ERP expectations without claiming authority", () => {
    expect(SIMULATION_ASSUMPTIONS.authority).toContain("SIMULATION_ONLY")
    for (const scenario of SIMULATION_SCENARIOS) {
      expect(scenario.taxBasisPoints).toBeGreaterThan(0)
      expect(scenario.tariffBasisPoints).toBeGreaterThanOrEqual(0)
      expect(scenario.erp.order).toMatch(/^SIM:/)
    }
  })
})
