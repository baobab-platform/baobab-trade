import { describe, expect, it } from "vitest"
import { buildAuthProviderConfiguration } from "../src/baobab/auth/providers"

describe("ZuriBeans Medusa customer OIDC", () => {
  it("denies production startup without confidential workforce OIDC and never enables Medusa passwords", () => {
    expect(() => buildAuthProviderConfiguration({ NODE_ENV: "production" })).toThrow(/confidential/)
    const configuration = buildAuthProviderConfiguration({
      NODE_ENV: "production",
      BAOBAB_IAM_OIDC_ISSUER: "https://iam.example.test/oauth",
      BAOBAB_IAM_OIDC_CLIENT_ID: "trade-workforce-confidential",
      BAOBAB_IAM_OIDC_CLIENT_SECRET: "test-fixture-only",
      BAOBAB_IAM_OIDC_CALLBACK_URL: "https://trade.example.test/auth/user/oidc/callback",
    })
    expect(configuration.providers.map(({ id }) => id)).toEqual(["oidc"])
    expect(configuration.methodsPerActor.user).toEqual(["oidc"])
    expect(configuration.methodsPerActor.customer).toEqual([])
    expect(configuration.methodsPerActor.user).not.toContain("emailpass")
    expect(configuration.methodsPerActor.customer).not.toContain("oidc")
  })

  it("refuses production HTTP, callback query and insecure extra customer callbacks", () => {
    const base = {
      NODE_ENV: "production",
      BAOBAB_IAM_OIDC_ISSUER: "https://iam.example.test/oauth",
      BAOBAB_IAM_OIDC_CLIENT_ID: "trade-admin",
      BAOBAB_IAM_OIDC_CLIENT_SECRET: "test-fixture-only",
      BAOBAB_IAM_OIDC_CALLBACK_URL: "https://trade.example.test/auth/user/oidc/callback",
    }
    expect(() => buildAuthProviderConfiguration({
      ...base,
      BAOBAB_IAM_OIDC_CALLBACK_URL: "http://localhost:9000/auth/user/oidc/callback",
    })).toThrow(/HTTPS/)
    expect(() => buildAuthProviderConfiguration({
      ...base, BAOBAB_IAM_OIDC_ISSUER: "https://iam.example.test/oauth?unsafe=1",
    })).toThrow(/query/)
    expect(() => buildAuthProviderConfiguration({
      ...base, BAOBAB_IAM_OIDC_CALLBACK_URL: "https://trade.example.test/auth/user/oidc/callback#fragment",
    })).toThrow(/fragment/)
    expect(() => buildAuthProviderConfiguration({
      ...base,
      BAOBAB_IAM_ZURIBEANS_OIDC_ISSUER: "https://iam.example.test/oauth",
      BAOBAB_IAM_ZURIBEANS_OIDC_CALLBACK_URL: "https://trade.example.test/api/auth/callback",
      BAOBAB_IAM_ZURIBEANS_OIDC_ALLOWED_CALLBACK_URLS: "https://trade.example.test/api/auth/callback,http://localhost:3000/api/auth/callback",
    })).toThrow(/HTTPS/)
    const ok = buildAuthProviderConfiguration({
      ...base,
      BAOBAB_IAM_ZURIBEANS_OIDC_ISSUER: "https://iam.example.test/oauth",
      BAOBAB_IAM_ZURIBEANS_OIDC_CALLBACK_URL: "https://trade.example.test/api/auth/callback",
    })
    expect(ok.methodsPerActor.customer).toEqual(["zuribeans-oidc"])
    expect(ok.methodsPerActor.user).toEqual(["oidc"])
  })

  it("stays disabled unless its issuer is explicitly configured", () => {
    const configuration = buildAuthProviderConfiguration({})
    expect(configuration.methodsPerActor.customer).toEqual(["emailpass"])
    expect(configuration.providers.map(({ id }) => id)).toEqual(["emailpass"])
  })

  it("uses Baobab IAM's public ZuriBeans client with exact callbacks", () => {
    const configuration = buildAuthProviderConfiguration({
      BAOBAB_IAM_ZURIBEANS_OIDC_ISSUER: "https://iam.example.test/realms/baobab",
      BAOBAB_IAM_ZURIBEANS_OIDC_CALLBACK_URL: "https://trade.zuribeans.example/api/auth/callback",
    })

    expect(configuration.methodsPerActor.customer).toEqual(["emailpass", "zuribeans-oidc"])
    expect(configuration.methodsPerActor.user).toEqual(["emailpass"])
    expect(configuration.providers.at(-1)).toMatchObject({
      id: "zuribeans-oidc",
      options: {
        client_id: "zuribeans-web",
        callback_url: "https://trade.zuribeans.example/api/auth/callback",
        allowed_callback_urls: ["https://trade.zuribeans.example/api/auth/callback"],
        scopes: ["openid", "profile", "email", "organization"],
        require_verified_email: true,
      },
    })
  })

  it("keeps workforce OIDC unavailable to customer actors", () => {
    const configuration = buildAuthProviderConfiguration({
      BAOBAB_IAM_OIDC_ISSUER: "https://iam.example.test/realms/workforce",
      BAOBAB_IAM_ZURIBEANS_OIDC_ISSUER: "https://iam.example.test/realms/customer",
    })

    expect(configuration.methodsPerActor.customer).toEqual(["emailpass", "zuribeans-oidc"])
    expect(configuration.methodsPerActor.user).toEqual(["emailpass", "oidc"])
  })

  it("rejects wildcard, insecure remote and ambiguous callback URLs", () => {
    const base = { BAOBAB_IAM_ZURIBEANS_OIDC_ISSUER: "https://iam.example.test/realms/baobab" }
    expect(() =>
      buildAuthProviderConfiguration({
        ...base,
        BAOBAB_IAM_ZURIBEANS_OIDC_CALLBACK_URL: "https://trade.example.test/*",
      }),
    ).toThrow(/wildcards/)
    expect(() =>
      buildAuthProviderConfiguration({
        ...base,
        BAOBAB_IAM_ZURIBEANS_OIDC_CALLBACK_URL: "http://trade.example.test/api/auth/callback",
      }),
    ).toThrow(/HTTPS/)
    expect(() =>
      buildAuthProviderConfiguration({
        ...base,
        BAOBAB_IAM_ZURIBEANS_OIDC_CALLBACK_URL:
          "https://trade.example.test/api/auth/callback?next=/account",
      }),
    ).toThrow(/query strings/)
    expect(() =>
      buildAuthProviderConfiguration({
        ...base,
        BAOBAB_IAM_ZURIBEANS_OIDC_CALLBACK_URL:
          "https://user:password@trade.example.test/api/auth/callback",
      }),
    ).toThrow(/credentials/)
  })

  it("requires the configured default callback to remain allowlisted", () => {
    expect(() =>
      buildAuthProviderConfiguration({
        BAOBAB_IAM_ZURIBEANS_OIDC_ISSUER: "https://iam.example.test/realms/baobab",
        BAOBAB_IAM_ZURIBEANS_OIDC_CALLBACK_URL: "https://trade.example.test/api/auth/callback",
        BAOBAB_IAM_ZURIBEANS_OIDC_ALLOWED_CALLBACK_URLS:
          "https://preview.example.test/api/auth/callback",
      }),
    ).toThrow(/must be present/)
  })
})
