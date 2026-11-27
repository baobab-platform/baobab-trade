export type AuthProviderRegistration = {
  resolve: string
  id: string
  options?: Record<string, unknown>
}

export type AuthProviderConfiguration = {
  providers: AuthProviderRegistration[]
  methodsPerActor: { customer: string[]; user: string[] }
}

// Production Medusa customer/admin actor login must not silently fall back to
// its local password provider when the governed Baobab IAM issuer is absent.
// This is an application Auth Module restriction, not a CP/Trade role grant.
const protectedRuntime = (environment: NodeJS.ProcessEnv): boolean =>
  environment.NODE_ENV !== "development" && environment.NODE_ENV !== "test"

const exactOIDCEndpoint = (raw: string, field: string, production: boolean): string => {
  // URL parsing normalizes dot segments and backslashes. Reject ambiguous
  // input before parsing so the configured issuer and callback stay exact.
  if (!/^https?:\/\//.test(raw) || /[\s\\]/.test(raw) || !raw.split("/")[2]) {
    throw new Error(`${field} must be an absolute HTTP(S) URL`)
  }
  if (raw.includes("*")) throw new Error(`${field} must not use wildcards`)
  if (/[?#]/.test(raw)) throw new Error(`${field} must not include query strings or fragments`)
  if (raw.split("/")[2].includes("@")) throw new Error(`${field} must not include credentials`)
  if (
    raw
      .split("/")
      .slice(3)
      .some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))
  ) {
    throw new Error(`${field} must not contain path traversal`)
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${field} must be an absolute HTTP(S) URL`)
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && !production && url.hostname === "localhost")
  ) {
    throw new Error(`${field} must use HTTPS outside local development`)
  }
  return raw
}

const exactCallbackUrls = (
  configured: string | undefined,
  fallback: string,
  production: boolean,
): string[] => {
  const values = configured
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [fallback]

  if (!values.length) {
    throw new Error("At least one ZuriBeans OIDC callback URL is required")
  }

  for (const value of values) {
    exactOIDCEndpoint(value, "ZuriBeans OIDC callback URL", production)
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
  // Absence of NODE_ENV is not an affirmative development authorization.
  // In particular, missing deployment configuration must not enable password
  // authentication on either Medusa actor.
  const production = protectedRuntime(environment)
  // Local email/password is a development compatibility mechanism, not an
  // alternate production workforce/customer credential authority.
  const providers: AuthProviderRegistration[] = production
    ? []
    : [{ resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" }]
  const customerMethods = production ? [] : ["emailpass"]

  if (
    production &&
    (!environment.BAOBAB_IAM_OIDC_ISSUER ||
      !environment.BAOBAB_IAM_OIDC_CLIENT_ID ||
      !environment.BAOBAB_IAM_OIDC_CLIENT_SECRET ||
      !environment.BAOBAB_IAM_OIDC_CALLBACK_URL)
  ) {
    throw new Error(
      "Production Medusa admin authentication requires a configured confidential Baobab IAM OIDC client",
    )
  }

  if (environment.BAOBAB_IAM_OIDC_ISSUER) {
    const issuer = exactOIDCEndpoint(
      environment.BAOBAB_IAM_OIDC_ISSUER,
      "Workforce issuer",
      production,
    )
    const callback = exactOIDCEndpoint(
      environment.BAOBAB_IAM_OIDC_CALLBACK_URL || "http://localhost:9000/auth/user/oidc/callback",
      "Workforce callback",
      production,
    )
    providers.push({
      resolve: "@medusajs/auth-oidc",
      id: "oidc",
      options: {
        issuer,
        client_id: environment.BAOBAB_IAM_OIDC_CLIENT_ID || "baobab-trade-admin",
        client_secret: environment.BAOBAB_IAM_OIDC_CLIENT_SECRET,
        callback_url: callback,
        display_name: "Baobab Workforce SSO",
      },
    })
  }

  const zuribeansIssuer = environment.BAOBAB_IAM_ZURIBEANS_OIDC_ISSUER
  if (zuribeansIssuer) {
    exactOIDCEndpoint(zuribeansIssuer, "ZuriBeans issuer", production)
    const callbackUrl =
      environment.BAOBAB_IAM_ZURIBEANS_OIDC_CALLBACK_URL ||
      "http://localhost:3000/api/auth/callback"
    exactOIDCEndpoint(callbackUrl, "ZuriBeans callback", production)
    const allowedCallbackUrls = exactCallbackUrls(
      environment.BAOBAB_IAM_ZURIBEANS_OIDC_ALLOWED_CALLBACK_URLS,
      callbackUrl,
      production,
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
