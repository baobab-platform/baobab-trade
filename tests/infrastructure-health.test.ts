import { describe, expect, it, vi } from "vitest"
import { verifyInfrastructureModules } from "../src/baobab/health/infrastructure"

describe("production infrastructure health", () => {
  it("resolves all six production infrastructure capabilities", () => {
    const service = {
      emit: vi.fn(),
      listWorkflowExecutions: vi.fn(),
      acquire: vi.fn(),
      get: vi.fn(),
      createFiles: vi.fn(),
      createNotifications: vi.fn(),
    }
    const container = { resolve: vi.fn(() => service) }
    expect(verifyInfrastructureModules(container)).toHaveLength(6)
    expect(container.resolve).toHaveBeenCalledTimes(6)
  })

  it("fails closed for an incorrectly registered provider", () => {
    expect(() => verifyInfrastructureModules({ resolve: () => ({}) })).toThrow(
      "Event Bus module 'event_bus' does not expose emit",
    )
  })
})
