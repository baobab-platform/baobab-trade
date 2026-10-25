import { describe, expect, it } from "vitest"
import {
  DEV07_COMPONENT_CASES,
  DEV07_BLOCKED_CASES,
  dev07Report,
} from "../src/baobab/development/dev07-report"

describe("DEV-07 component evidence boundary", () => {
  it("retains every unimplemented original obligation as BLOCKED", () => {
    const report = dev07Report([...DEV07_COMPONENT_CASES], "a".repeat(40))
    expect(Object.values(report.cases).filter((r) => r.result === "PASS")).toHaveLength(16)
    for (const name of Object.keys(DEV07_BLOCKED_CASES))
      expect(report.cases[name].result).toBe("BLOCKED")
    expect(report.int05_qualified).toBe(false)
    expect(report.current_iam_cp_buyer_qualified).toBe(false)
    expect(report.protected_acceptance).toBe(false)
    expect(report.production_authorized).toBe(false)
  })
  it.each(
    [
      [],
      DEV07_COMPONENT_CASES.slice(1),
      [...DEV07_COMPONENT_CASES, DEV07_COMPONENT_CASES[0]],
      [...DEV07_COMPONENT_CASES.slice(1), "invented"],
    ].map((observed) => ({ observed })),
  )("rejects missing, duplicated or invented observations", ({ observed }) => {
    expect(() => dev07Report(observed as unknown as string[], "a".repeat(40))).toThrow()
  })
  it("requires immutable source identity", () => {
    expect(() => dev07Report([...DEV07_COMPONENT_CASES], "main")).toThrow()
  })
})
