import { describe, expect, it } from "vitest"
import { THAMANI_CATALOGUE } from "../src/baobab/thamani/catalogue"
import { THAMANI_SUPPLIERS } from "../src/baobab/thamani/suppliers"
import {
  assertThamaniSimulationDataset,
  THAMANI_SIMULATION_CONSUMERS,
  THAMANI_SIMULATION_ORDER_SCENARIOS,
} from "../src/baobab/thamani/simulation"

describe("Gate 22 Thamani simulation dataset", () => {
  it("validates all cross-domain references", () =>
    expect(assertThamaniSimulationDataset).not.toThrow())

  it("keeps the product/supplier catalogue within the plan's named ranges", () => {
    expect(THAMANI_CATALOGUE.length).toBeGreaterThanOrEqual(35)
    expect(THAMANI_CATALOGUE.length).toBeLessThanOrEqual(40)
    expect(THAMANI_SUPPLIERS.length).toBeGreaterThanOrEqual(15)
    expect(THAMANI_SUPPLIERS.length).toBeLessThanOrEqual(20)
  })

  it("has exactly fifty consumers spanning both Markets, with unique references and emails", () => {
    expect(THAMANI_SIMULATION_CONSUMERS).toHaveLength(50)
    expect(THAMANI_SIMULATION_CONSUMERS.filter((c) => c.marketKey === "thamani_ug")).toHaveLength(
      25,
    )
    expect(THAMANI_SIMULATION_CONSUMERS.filter((c) => c.marketKey === "thamani_za")).toHaveLength(
      25,
    )
    expect(new Set(THAMANI_SIMULATION_CONSUMERS.map((c) => c.reference)).size).toBe(50)
    expect(new Set(THAMANI_SIMULATION_CONSUMERS.map((c) => c.email)).size).toBe(50)
  })

  it("covers a captured order, a returned/refunded order and a cross-border import order", () => {
    expect(THAMANI_SIMULATION_ORDER_SCENARIOS.some((s) => s.outcome === "CAPTURED")).toBe(true)
    expect(THAMANI_SIMULATION_ORDER_SCENARIOS.some((s) => s.outcome === "REFUNDED")).toBe(true)
    expect(THAMANI_SIMULATION_ORDER_SCENARIOS.some((s) => s.crossBorderImport)).toBe(true)
  })

  it("gives every scenario complete ERP expectations, and refunded scenarios a return/refund reference", () => {
    for (const scenario of THAMANI_SIMULATION_ORDER_SCENARIOS) {
      expect(scenario.erp.order).toMatch(/^SIM:THAMANI:/)
      expect(scenario.erp.payment).toMatch(/^SIM:THAMANI:/)
      if (scenario.outcome === "REFUNDED")
        expect(scenario.erp.returnRefund).toMatch(/^SIM:THAMANI:/)
    }
  })
})
