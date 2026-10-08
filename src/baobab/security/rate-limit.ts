/**
 * Fixed-window rate limiting, storage-agnostic behind `RateLimitStore` — the
 * same typed-extraction-seam shape as `CommerceCapabilityPorts`
 * (`src/baobab/ports.ts`): a policy function plus one reference adapter,
 * ready to be backed by Redis in production without this module changing.
 * Exists to close the abuse-control gap the architecture docs flag as
 * deliberately deferred (`docs/architecture/thamani-promotions.md`), and is
 * the control `verifyGuestOrderLookup`
 * (`src/baobab/thamani/customer/authorization.ts`) needs keyed per caller to
 * stop order-number/email enumeration.
 */
export type RateLimitDecision = {
  allowed: boolean
  remaining: number
  resetAt: Date
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: Date }>
}

export class RateLimitExceededError extends Error {
  constructor(
    readonly key: string,
    readonly resetAt: Date,
  ) {
    super(`Rate limit exceeded for "${key}"; resets at ${resetAt.toISOString()}`)
    this.name = "RateLimitExceededError"
  }
}

export const assertWithinRateLimit = async (
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitDecision> => {
  const { count, resetAt } = await store.increment(key, windowMs)
  if (count > limit) throw new RateLimitExceededError(key, resetAt)
  return { allowed: true, remaining: limit - count, resetAt }
}

/** Reference adapter — fine for a single process; production needs a shared (Redis) store. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: Date }>()

  async increment(key: string, windowMs: number) {
    const now = Date.now()
    const existing = this.windows.get(key)
    if (!existing || existing.resetAt.getTime() <= now) {
      const created = { count: 1, resetAt: new Date(now + windowMs) }
      this.windows.set(key, created)
      return created
    }
    existing.count += 1
    return existing
  }
}
