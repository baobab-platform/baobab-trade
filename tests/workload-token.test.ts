import { afterEach, describe, expect, it, vi } from "vitest"
import { ClientCredentialsWorkloadTokenProvider } from "../src/baobab/control-plane/workload-token"

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response

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
    expect(init.headers["content-type"]).toBe("application/x-www-form-urlencoded")
    expect(init.body.toString()).toBe(
      "grant_type=client_credentials&client_id=baobab-trade-workload&client_secret=secret-1",
    )
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
      .mockResolvedValue(jsonResponse(200, { access_token: "tok-1", expires_in: 300 }))
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
})
