export type AuthProviderRegistration = {
  resolve: string
  id: string
  options?: Record<string, unknown>
}

export type AuthProviderConfiguration = {
  providers: AuthProviderRegistration[]
  methodsPerActor: { customer: string[]; user: string[] }
}

const exactCallbackUrls = (configured: string | undefined, fallback: string): string[] => {
  const values = configured
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [fallback]

  if (!values.length) {
    throw new Error("At least one ZuriBeans OIDC callback URL is required")
  }

  for (const value of values) {
    if (value.includes("*")) {
      throw new Error("ZuriBeans OIDC callback URLs must not use wildcards")
    }
    const url = new URL(value)
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
      throw new Error("ZuriBeans OIDC callback URLs must use HTTPS outside localhost")
    }
    if (url.username || url.password) {
      throw new Error("ZuriBeans OIDC callback URLs must not include credentials")
    }
    if (url.search || url.hash) {
      throw new Error("ZuriBeans OIDC callback URLs must not include query strings or fragments")
    }
  }

  return [...new Set(values)]
}

/**
 * Builds Medusa Auth Module providers without granting business authority.
 * OIDC establishes a customer actor binding; B2B organisation membership,
 * approval state, roles and purchase authority remain Trade-owned checks.
 */
export const buildAuthProviderConfiguration = (
  environment: NodeJS.ProcessEnv,
): AuthProviderConfiguration => {
  const providers: AuthProviderRegistration[] = [
    { resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" },
  ]
  const customerMethods = ["emailpass"]

  if (environment.BAOBAB_IAM_OIDC_ISSUER) {
    providers.push({
      resolve: "@medusajs/auth-oidc",
      id: "oidc",
      options: {
        issuer: environment.BAOBAB_IAM_OIDC_ISSUER,
        client_id: environment.BAOBAB_IAM_OIDC_CLIENT_ID || "baobab-trade-admin",
        client_secret: environment.BAOBAB_IAM_OIDC_CLIENT_SECRET,
        callback_url:
          environment.BAOBAB_IAM_OIDC_CALLBACK_URL ||
          "http://localhost:9000/auth/user/oidc/callback",
        display_name: "Baobab Workforce SSO",
      },
    })
  }

  const zuribeansIssuer = environment.BAOBAB_IAM_ZURIBEANS_OIDC_ISSUER
  if (zuribeansIssuer) {
    const callbackUrl =
      environment.BAOBAB_IAM_ZURIBEANS_OIDC_CALLBACK_URL ||
      "http://localhost:3000/api/auth/callback"
    const allowedCallbackUrls = exactCallbackUrls(
      environment.BAOBAB_IAM_ZURIBEANS_OIDC_ALLOWED_CALLBACK_URLS,
      callbackUrl,
    )
    if (!allowedCallbackUrls.includes(callbackUrl)) {
      throw new Error("The default ZuriBeans OIDC callback URL must be present in its allowlist")
    }

    providers.push({
      resolve: "@medusajs/auth-oidc",
      id: "zuribeans-oidc",
      options: {
        issuer: zuribeansIssuer,
        client_id: environment.BAOBAB_IAM_ZURIBEANS_OIDC_CLIENT_ID || "zuribeans-web",
        callback_url: callbackUrl,
        allowed_callback_urls: allowedCallbackUrls,
        scopes: ["openid", "profile", "email", "organization"],
        require_verified_email: true,
        display_name: "ZuriBeans Buyer SSO",
      },
    })
    customerMethods.push("zuribeans-oidc")
  }

  return {
    providers,
    methodsPerActor: {
      customer: customerMethods,
      user: providers.filter(({ id }) => id !== "zuribeans-oidc").map(({ id }) => id),
    },
  }
}
