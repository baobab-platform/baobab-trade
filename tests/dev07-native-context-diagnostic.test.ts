import { describe, expect, it } from "vitest"
import { nativeContextDiagnostic } from "../src/baobab/development/dev07-iam-cp"

describe("DEV-07 sanitized native context diagnostics", () => {
  it("distinguishes closed refusals and mismatched successful contexts", () => {
    expect(nativeContextDiagnostic(503, { decision: { reasons: ["SOURCE_UNAVAILABLE"] } })).toBe(
      "DEV07_NATIVE_CONTEXT=HTTP_503_REASON_SOURCE_UNAVAILABLE",
    )
    expect(nativeContextDiagnostic(200, { private_token: "never-release" })).toBe(
      "DEV07_NATIVE_CONTEXT=HTTP_200_REASON_CONTEXT_MISMATCH",
    )
  })
  it("suppresses unknown reasons, statuses and arbitrary provider response content", () => {
    for (const body of [
      { decision: { reasons: ["secret"] }, token: "private" },
      { decision: { reasons: ["SOURCE_UNAVAILABLE\\nsecret"] } },
      { decision: { reasons: ["SOURCE_UNAVAILABLE", "secret"] } },
      { decision: null },
    ]) {
      expect(nativeContextDiagnostic(999, body)).toBe(
        "DEV07_NATIVE_CONTEXT=HTTP_OTHER_REASON_OTHER",
      )
    }
  })
})
