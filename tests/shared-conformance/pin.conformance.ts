import { describe, expect, it } from "vitest"
import { lock, pathExists, sharedHead, unloadedSchemas } from "./shared"

describe("Shared pin", () => {
  it("runs against exactly the commit contracts.lock.yaml pins", () => {
    expect(lock.source.repository).toBe("baobab-platform/shared")
    expect(sharedHead()).toBe(lock.source.commit)
  })

  it.each(lock.contracts)("pinned contract %s exists at the pin", (contract) => {
    expect(pathExists(contract)).toBe(true)
  })

  it("every Shared schema loads, so no reference can resolve to a missing contract", () => {
    expect(unloadedSchemas).toEqual([])
  })
})
