import { authenticate } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { describe, expect, it, vi } from "vitest"
import { signExpiredRealToken, signRealToken, TEST_JWT_SECRET } from "./support/real-token"

/**
 * Gate ZB-03.7: this repo already wires the real
 * @medusajs/framework/http `authenticate()` middleware onto
 * /store/b2b/context and /admin/b2b/organisations/:id/canonical-link
 * (src/api/middlewares.ts), but nothing exercised that middleware against
 * an actual signed JWT -- every existing test builds a BuyerContext or
 * auth_context by hand. This drives the real, unmodified `authenticate()`
 * export (not a reimplementation) through its full verification path:
 * signature, expiry, and actor-type matching.
 */
const fakeRequest = (authorizationHeader?: string) => ({
  headers: authorizationHeader ? { authorization: authorizationHeader } : {},
  session: {},
  scope: {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.LOGGER) {
        return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
      }
      if (key === ContainerRegistrationKeys.CONFIG_MODULE) {
        return { projectConfig: { http: { jwtSecret: TEST_JWT_SECRET } } }
      }
      throw new Error(`unexpected container key requested: ${key}`)
    },
  },
})

const fakeResponse = () => {
  const res: { statusCode?: number; body?: unknown; status: (code: number) => typeof res } = {
    status(code: number) {
      res.statusCode = code
      return res
    },
  }
  ;(res as unknown as { json: (body: unknown) => void }).json = (body: unknown) => {
    res.body = body
  }
  return res as typeof res & { json: (body: unknown) => void; statusCode?: number; body?: unknown }
}

const runAuthenticate = async (actorType: "customer" | "user", authorizationHeader?: string) => {
  const middleware = authenticate(actorType, ["session", "bearer"])
  const req = fakeRequest(authorizationHeader)
  const res = fakeResponse()
  const next = vi.fn()
  await middleware(req as never, res as never, next)
  return { req, res, next }
}

describe("authenticate() middleware against real signed JWTs (Gate ZB-03.7)", () => {
  it("rejects a request with no Authorization header", async () => {
    const { res, next } = await runAuthenticate("customer", undefined)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it("sets req.auth_context and calls next() for a validly signed customer bearer token", async () => {
    const token = signRealToken({ actor_id: "cus_1", actor_type: "customer" })
    const { req, next } = await runAuthenticate("customer", `Bearer ${token}`)
    expect(next).toHaveBeenCalledTimes(1)
    expect((req as { auth_context?: { actor_id: string } }).auth_context?.actor_id).toBe("cus_1")
  })

  it("rejects a token signed with the wrong secret (forged signature)", async () => {
    const forged = signRealToken(
      { actor_id: "cus_1", actor_type: "customer" },
      { secret: "not-the-real-secret" },
    )
    const { res, next } = await runAuthenticate("customer", `Bearer ${forged}`)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it("rejects an expired token", async () => {
    const expired = signExpiredRealToken({ actor_id: "cus_1", actor_type: "customer" })
    const { res, next } = await runAuthenticate("customer", `Bearer ${expired}`)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it("rejects a correctly signed token for the wrong actor type", async () => {
    // A workforce ("user") token must never authenticate a buyer-only route,
    // even though the signature and expiry are both valid.
    const workforceToken = signRealToken({ actor_id: "usr_1", actor_type: "user" })
    const { res, next } = await runAuthenticate("customer", `Bearer ${workforceToken}`)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it("rejects a malformed Authorization header", async () => {
    const { res, next } = await runAuthenticate("customer", "not-a-bearer-token")
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })
})
