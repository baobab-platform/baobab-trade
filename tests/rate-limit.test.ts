import { describe, expect, it } from "vitest"
import {
  assertWithinRateLimit,
  InMemoryRateLimitStore,
  RateLimitExceededError,
} from "../src/baobab/security"
import { verifyGuestOrderLookup } from "../src/baobab/thamani/customer"

describe("Gate 19 rate limiting", () => {
  it("allows up to the limit within the window and reports remaining attempts", async () => {
    const store = new InMemoryRateLimitStore()
    const first = await assertWithinRateLimit(store, "ip:1.2.3.4", 3, 60_000)
    expect(first.remaining).toBe(2)
    const second = await assertWithinRateLimit(store, "ip:1.2.3.4", 3, 60_000)
    expect(second.remaining).toBe(1)
  })

  it("blocks once the limit is exceeded within the window", async () => {
    const store = new InMemoryRateLimitStore()
    for (let i = 0; i < 3; i++) await assertWithinRateLimit(store, "ip:1.2.3.4", 3, 60_000)
    await expect(assertWithinRateLimit(store, "ip:1.2.3.4", 3, 60_000)).rejects.toThrow(
      RateLimitExceededError,
    )
  })

  it("tracks each key's window independently", async () => {
    const store = new InMemoryRateLimitStore()
    for (let i = 0; i < 3; i++) await assertWithinRateLimit(store, "ip:1.2.3.4", 3, 60_000)
    await expect(assertWithinRateLimit(store, "ip:5.6.7.8", 3, 60_000)).resolves.toMatchObject({
      remaining: 2,
    })
  })

  it("bounds guest order lookup enumeration attempts per caller", async () => {
    const store = new InMemoryRateLimitStore()
    const order = { displayId: "1042", email: "consumer@example.com" }
    const attemptLookup = async (guessedDisplayId: string) => {
      await assertWithinRateLimit(store, "ip:1.2.3.4:guest-order-lookup", 5, 60_000)
      verifyGuestOrderLookup({ displayId: guessedDisplayId, email: "attacker@example.com" }, order)
    }
    for (let i = 0; i < 5; i++) {
      await expect(attemptLookup(`${1000 + i}`)).rejects.toThrow(/No order matches/)
    }
    await expect(attemptLookup("1042")).rejects.toThrow(RateLimitExceededError)
  })
})
