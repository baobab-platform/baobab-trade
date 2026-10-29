import { afterEach, describe, expect, it, vi } from "vitest"
import { ClientCredentialsWorkloadTokenProvider } from "../src/baobab/control-plane/workload-token"

const jsonResponse = (status: number, body: unknown) => Response.json(body, { status })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ClientCredentialsWorkloadTokenProvider", () => {
  it("requests a token via client_credentials with a form-encoded body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { access_token: "tok-1", expires_in: 300 }))
    vi.stubGlobal("fetch", fetchMock)

    const provider = new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: "https://iam.example.test/realms/baobab/protocol/openid-connect/token",
      clientId: "baobab-trade-workload",
      clientSecret: "secret-1",
    })

    const token = await provider.getAccessToken()

    expect(token).toBe("tok-1")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://iam.example.test/realms/baobab/protocol/openid-connect/token")
    expect(init.method).toBe("POST")
    expect(init.redirect).toBe("error")
    expect(init.cache).toBe("no-store")
    expect(init.headers["content-type"]).toBe("application/x-www-form-urlencoded")
    expect(init.body.toString()).toBe(
      "grant_type=client_credentials&client_id=baobab-trade-workload&client_secret=secret-1",
    )
  })

  it("binds CP workload grants to the exact CP audience when configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { access_token: "cp-token", expires_in: 55 }))
    vi.stubGlobal("fetch", fetchMock)

    const provider = new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: "https://iam.example.test/oauth2/token",
      clientId: "baobab-dev-trade-buyer-validator",
      clientSecret: "private-client-secret",
      scope: "identity:principal:resolve",
      audience: "baobab-control-plane",
    })
    expect(await provider.getAccessToken()).toBe("cp-token")
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body.toString())
    expect(Object.fromEntries(body.entries())).toEqual({
      grant_type: "client_credentials",
      client_id: "baobab-dev-trade-buyer-validator",
      client_secret: "private-client-secret",
      scope: "identity:principal:resolve",
      audience: "baobab-control-plane",
    })
  })

  it("caches the token until close to its stated expiry", async () => {
    let now = 0
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { access_token: "tok-1", expires_in: 300 }))
    vi.stubGlobal("fetch", fetchMock)

    const provider = new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: "https://iam.example.test/token",
      clientId: "baobab-trade-workload",
      clientSecret: "secret-1",
      now: () => now,
    })

    await provider.getAccessToken()
    now += 100_000
    await provider.getAccessToken()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("refreshes ahead of the stated expiry rather than risking a mid-call expiry", async () => {
    let now = 0
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse(200, { access_token: "tok-1", expires_in: 300 }))
    vi.stubGlobal("fetch", fetchMock)

    const provider = new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: "https://iam.example.test/token",
      clientId: "baobab-trade-workload",
      clientSecret: "secret-1",
      now: () => now,
    })

    await provider.getAccessToken()
    now += 271_000 // past (300 - 30)s safety margin
    await provider.getAccessToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("fails closed on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: "invalid_client" })),
    )

    const provider = new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: "https://iam.example.test/token",
      clientId: "baobab-trade-workload",
      clientSecret: "wrong-secret",
    })

    await expect(provider.getAccessToken()).rejects.toThrow("status 401")
  })

  it("fails closed on a non-conforming 200 body rather than trusting it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { token_type: "Bearer" })))

    const provider = new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: "https://iam.example.test/token",
      clientId: "baobab-trade-workload",
      clientSecret: "secret-1",
    })

    await expect(provider.getAccessToken()).rejects.toThrow("invalid workload token response")
  })

  it.each([NaN, Infinity, 0.5, 0, -1, 86401])(
    "refuses malformed or unbounded token lifetimes: %s",
    async (expires_in) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(jsonResponse(200, { access_token: "opaque-unit-token", expires_in })),
      )
      const provider = new ClientCredentialsWorkloadTokenProvider({
        tokenUrl: "https://iam.example.test/token",
        clientId: "client",
        clientSecret: "secret",
      })
      await expect(provider.getAccessToken()).rejects.toThrow("invalid workload token response")
    },
  )

  it("does not extend the cache lifetime by endpoint latency", async () => {
    let now = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      now += 20_000
      return jsonResponse(200, { access_token: "opaque-unit-token", expires_in: 55 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const provider = new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: "https://iam.example.test/token",
      clientId: "client",
      clientSecret: "secret",
      now: () => now,
    })
    await provider.getAccessToken()
    now = 26_000 // outside (55 - 30)s counted from request start, not receipt
    await provider.getAccessToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("refuses a token already expired while waiting for the endpoint", async () => {
    let now = 0
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        now = 55_000
        return jsonResponse(200, { access_token: "opaque-unit-token", expires_in: 55 })
      }),
    )
    const provider = new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: "https://iam.example.test/token",
      clientId: "client",
      clientSecret: "secret",
      now: () => now,
    })
    await expect(provider.getAccessToken()).rejects.toThrow("no longer current")
  })

  it("bounds the response body and refuses invalid UTF-8, JSON and content types", async () => {
    for (const response of [
      new Response("x".repeat(65537), { headers: { "content-type": "application/json" } }),
      new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
      new Response("private token body", { headers: { "content-type": "application/json" } }),
      new Response("private token body", { headers: { "content-type": "text/html" } }),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))
      const provider = new ClientCredentialsWorkloadTokenProvider({
        tokenUrl: "https://iam.example.test/token",
        clientId: "client",
        clientSecret: "secret",
      })
      await expect(provider.getAccessToken()).rejects.toThrow("invalid workload token response")
    }
  })

  it("aborts a peer that stalls after response headers and cancels its body", async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"access_token":'))
      },
      cancel,
    })
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } })),
    )
    const provider = new ClientCredentialsWorkloadTokenProvider({
      tokenUrl: "https://iam.example.test/token",
      clientId: "client",
      clientSecret: "secret",
      timeoutMs: 20,
    })
    await expect(provider.getAccessToken()).rejects.toThrow("invalid workload token response")
    expect(cancel).toHaveBeenCalledOnce()
  })
})
