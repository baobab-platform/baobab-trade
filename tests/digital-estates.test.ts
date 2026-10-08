import { describe, expect, it } from "vitest"
import {
  THAMANI_DIGITAL_ESTATE_CANONICAL_ID,
  ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID,
} from "../src/baobab/context"

describe("Digital Estate canonical IDs", () => {
  it("distinguishes ZuriBeans B2B from Thamani B2C as separate estates", () => {
    expect(ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID).not.toBe(THAMANI_DIGITAL_ESTATE_CANONICAL_ID)
    expect(ZURIBEANS_DIGITAL_ESTATE_CANONICAL_ID).toMatch(/^estate:/)
    expect(THAMANI_DIGITAL_ESTATE_CANONICAL_ID).toMatch(/^estate:/)
  })
})
