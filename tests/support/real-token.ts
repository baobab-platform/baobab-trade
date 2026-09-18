import jwt from "jsonwebtoken"

/**
 * Gate ZB-03.7: signs a JWT shaped exactly like the payload
 * @medusajs/framework/http's `authenticate()` middleware verifies and then
 * assigns verbatim as `req.auth_context`
 * (node_modules/@medusajs/framework/dist/http/middlewares/authenticate-middleware.js,
 * `getAuthContextFromJwtToken`: `jsonwebtoken.verify(token, jwtSecret,
 * options)`'s return value IS the auth context, with no further mapping).
 * This is what `@medusajs/auth-oidc` mints after a real Baobab IAM OIDC
 * exchange -- signing one directly here, rather than hand-constructing an
 * auth_context object, is what actually exercises `authenticate()`'s real
 * verification path (signature, expiry, actor-type matching) instead of
 * assuming it works.
 */
export type RealTokenClaims = {
  actor_id: string
  actor_type: "customer" | "user"
  auth_identity_id?: string
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}

export const TEST_JWT_SECRET = "test-jwt-secret-for-zb03-7-real-token-verification"

export const signRealToken = (
  claims: RealTokenClaims,
  options: { secret?: string; expiresInSeconds?: number } = {},
): string =>
  jwt.sign(
    {
      actor_id: claims.actor_id,
      actor_type: claims.actor_type,
      auth_identity_id: claims.auth_identity_id ?? `authid_${claims.actor_id}`,
      app_metadata: claims.app_metadata ?? {},
      user_metadata: claims.user_metadata ?? {},
    },
    options.secret ?? TEST_JWT_SECRET,
    { expiresIn: options.expiresInSeconds ?? 900 },
  )

export const signExpiredRealToken = (claims: RealTokenClaims): string =>
  jwt.sign(
    {
      actor_id: claims.actor_id,
      actor_type: claims.actor_type,
      auth_identity_id: claims.auth_identity_id ?? `authid_${claims.actor_id}`,
      app_metadata: claims.app_metadata ?? {},
      user_metadata: claims.user_metadata ?? {},
      iat: Math.floor(Date.now() / 1000) - 3600,
      exp: Math.floor(Date.now() / 1000) - 1800,
    },
    TEST_JWT_SECRET,
  )
