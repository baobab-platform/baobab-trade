import { describe, expect, it } from "vitest"
import { buildAuthProviderConfiguration } from "../src/baobab/auth/providers"

describe("ZuriBeans Medusa customer OIDC", () => {
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
