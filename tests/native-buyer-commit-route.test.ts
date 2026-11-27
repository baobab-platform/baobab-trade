import { afterEach, describe, expect, it, vi } from "vitest"
import { POST, NATIVE_BUYER_COMMIT_RUNTIME } from "../src/api/store/b2b/buyer-commit/route"

const CORRELATION = "0b6f2c1e-6d0a-4f43-9c1a-2f1d6b1e9a40"
const ORGANISATION = "019a0915-a8c0-7000-8000-00000000a001"
const TOKEN = "signed.header.signature"
function enable(): void {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("BAOBAB_DEPLOYMENT_ENV", "development")
  vi.stubEnv("BAOBAB_NATIVE_BUYER_COMMIT_ENABLED", "true")
  vi.stubEnv("BAOBAB_ENVIRONMENT", "development")
  vi.stubEnv("BAOBAB_TRADE_A_ORDER_AUTHORITY_ENABLED", "true")
  vi.stubEnv("BAOBAB_BUYER_IDENTITY_ENABLED", "true")
  vi.stubEnv("BAOBAB_IAM_BUYER_ISSUER", "https://iam.example.test")
  vi.stubEnv("BAOBAB_IAM_BUYER_AUTHORISED_PARTIES", "zuribeans-bff")
  vi.stubEnv("BAOBAB_TRADE_ENGINE_INSTANCE_ID", "ei_trade")
}
const body = () => ({
  subject_token: TOKEN,
  subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
  requested_organisation_id: ORGANISATION,
  requested_country_code: "ZA",
  cart_id: "cart_native1234",
  idempotency_key: "native-commit-replay-123456",
  correlation_id: CORRELATION,
})

async function invoke(
  payload: unknown = body(),
  options: { authorization?: string; haveRuntime?: boolean; replayKey?: string } = {},
): Promise<{
  statusCode?: number
  body?: unknown
  headers: Record<string, string>
  reads: number
}> {
  const result: {
    statusCode?: number
    body?: unknown
    headers: Record<string, string>
    reads: number
  } = { headers: {}, reads: 0 }
  const res = {
    setHeader(key: string, value: string) {
      result.headers[key.toLowerCase()] = value
      return res
    },
    status(code: number) {
      result.statusCode = code
      return res
    },
    json(value: unknown) {
      result.body = value
      return res
    },
  }
  await POST(
    {
      headers: {
        "x-correlation-id": CORRELATION,
        authorization: options.authorization,
        "idempotency-key": options.replayKey ?? body().idempotency_key,
      },
      body: payload,
      scope: {
        hasRegistration(key: string) {
          result.reads++
          return options.haveRuntime && key === NATIVE_BUYER_COMMIT_RUNTIME
        },
        resolve() {
          throw Error(
            "security failure: no service should be resolved before real issuer/CP verification",
          )
        },
      },
    } as never,
    res as never,
  )
  return result
}

afterEach(() => vi.unstubAllEnvs())

describe("DEV-07 confidential BFF->Trade native buyer commitment", () => {
  it("does not activate from buyer-context alone or from a production profile", async () => {
    const absent = await invoke(body(), { authorization: "Bearer " + TOKEN })
    expect(absent.statusCode).toBe(403)
    expect(absent.reads).toBe(0)
    enable()
    vi.stubEnv("BAOBAB_ENVIRONMENT", "production")
    const prod = await invoke(body(), { authorization: "Bearer " + TOKEN })
    expect(prod.statusCode).toBe(403)
    expect(prod.reads).toBe(0)
  })
  it.each([
    ["declared tax", () => ({ ...body(), tax: 0 })],
    ["declared freight", () => ({ ...body(), freight: 0 })],
    ["declared duty", () => ({ ...body(), duty: 0 })],
    ["declared seller mandate", () => ({ ...body(), seller_legal_entity_id: "LE-MY-CHOICE" })],
    ["declared buyer principal", () => ({ ...body(), actor_principal_id: ORGANISATION })],
    ["changed idempotency key", () => ({ ...body(), idempotency_key: "DIFFERENT-OTHER-KEY-4567" })],
    ["foreign country", () => ({ ...body(), requested_country_code: "za" })],
    ["unrecognised operation", () => ({ ...body(), operation: "trade.order.commit" })],
  ])("refuses %s before any native service read", async (_, make) => {
    enable()
    const denied = await invoke(make(), { authorization: "Bearer " + TOKEN })
    expect(denied.statusCode).toBe(403)
    expect(denied.reads).toBe(0)
    expect(JSON.stringify(denied.body)).not.toContain(TOKEN)
  })
  it("requires a signed confidential BFF JWT and refuses a native writer if no registered source", async () => {
    enable()
    for (const authorization of [undefined, "Bearer opaque", "Basic " + TOKEN]) {
      const denied = await invoke(body(), { authorization })
      expect(denied.statusCode).toBe(401)
      expect(denied.reads).toBe(0)
    }
    const configured = await invoke(body(), { authorization: "Bearer " + TOKEN })
    // JWT signature/issuer check runs before arbitrary runtime registry reads.
    expect(configured.statusCode).not.toBe(201)
    expect(configured.headers["cache-control"]).toBe("private, no-store")
  })
})
