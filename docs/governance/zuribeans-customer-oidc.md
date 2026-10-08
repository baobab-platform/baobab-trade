# ZuriBeans customer OIDC boundary

## Accepted decisions applied

Baobab IAM authenticates the human principal. Baobab Trade binds the authenticated subject to a Medusa customer identity and remains authoritative for B2B organisation membership, buyer roles, approval state, and purchasing authority. Authentication never implies approved trading access.

The ZuriBeans provider is registered as a public OIDC client without a client secret. Medusa's OIDC provider uses authorization code flow with PKCE, nonce, state, issuer and audience validation. The stable OIDC `sub` claim identifies the authentication identity; mutable email addresses do not.

## Runtime configuration

The provider is disabled unless `BAOBAB_IAM_ZURIBEANS_OIDC_ISSUER` is configured. Production also requires:

- `BAOBAB_IAM_ZURIBEANS_OIDC_CALLBACK_URL`, using HTTPS;
- `BAOBAB_IAM_ZURIBEANS_OIDC_ALLOWED_CALLBACK_URLS`, containing the exact default callback and any explicitly approved preview callbacks;
- an IAM public client matching `BAOBAB_IAM_ZURIBEANS_OIDC_CLIENT_ID`, defaulting to `zuribeans-web`.

Wildcards, credentials, query strings, fragments, and non-local HTTP callbacks are rejected at startup. The default local callback is `http://localhost:3000/api/auth/callback`.

## Authorization boundary

The provider is available only to Medusa `customer` actors. Workforce OIDC remains available only to `user` actors. After authentication, every protected commercial operation must still revalidate the active Trade-owned organisation membership and applicable purchasing authority.
