// Trade-A TA-08 harness test OIDC issuer. CI only, never deployed.
//
// Ported from the ERP-A / Payments Gate D1 harness issuer to node:crypto, so
// the harness needs no third-party packages. It stands in for Baobab IAM and
// issues real RS256-signed JWTs that CP verifies exactly as in production:
// OIDC discovery, a JWKS, issuer, audience, lifetime and claim checks.
//
//   GET  /realms/baobab/.well-known/openid-configuration
//   GET  /realms/baobab/certs
//   POST /realms/baobab/token   client_credentials for registered workload
//                               clients (form-encoded, secret checked)
//
// Harness-only endpoints, reachable on the published harness port and never
// through the TLS edge:
//
//   POST /_mint   mint a human administrator token (with its assurance)
//   GET  /_log    every token issued (client, subject, scopes, jti), never a token
import { createServer } from "node:http"
import { generateKeyPairSync, randomUUID, sign, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"

if (process.env.BAOBAB_ENVIRONMENT !== "integration") {
  console.error("the TA-08 test issuer runs only with BAOBAB_ENVIRONMENT=integration")
  process.exit(2)
}
const REALM = "/realms/baobab"
const ISSUER = process.env.ISSUER // https://iam.gated.test/realms/baobab
const LIFETIME = 300
const KID = `ta08-${randomUUID().slice(0, 8)}`
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
// Registered workload clients: id -> { secret, audience, scopes }.
const CLIENTS = JSON.parse(readFileSync(process.env.CLIENTS_FILE, "utf8"))
const LOG = []

const b64 = (value) => Buffer.from(value).toString("base64url")

function issue(subject, audience, scopes, actorType, client, extra = {}) {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: ISSUER,
    sub: subject,
    aud: audience,
    azp: client,
    scope: scopes.join(" "),
    actor_type: actorType,
    iat: now,
    nbf: now,
    exp: now + LIFETIME,
    jti: randomUUID(),
    ...extra,
  }
  LOG.push({ at: now, client, subject, actor_type: actorType, audience, scopes, jti: claims.jti })
  const input = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID }))}.${b64(JSON.stringify(claims))}`
  return `${input}.${sign("sha256", Buffer.from(input), privateKey).toString("base64url")}`
}

const secretMatches = (expected, given) => {
  const a = Buffer.from(expected)
  const b = Buffer.from(given ?? "")
  return a.length === b.length && timingSafeEqual(a, b)
}

function send(res, status, body) {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(raw),
  })
  res.end(raw)
}

const server = createServer((req, res) => {
  const path = new URL(req.url, "http://issuer").pathname
  let raw = ""
  req.on("data", (chunk) => (raw += chunk))
  req.on("end", () => {
    if (req.method === "GET" && path === `${REALM}/.well-known/openid-configuration`)
      return send(res, 200, {
        issuer: ISSUER,
        jwks_uri: `${ISSUER}/certs`,
        token_endpoint: `${ISSUER}/token`,
        id_token_signing_alg_values_supported: ["RS256"],
        grant_types_supported: ["client_credentials"],
        response_types_supported: ["token"],
        subject_types_supported: ["public"],
      })
    if (req.method === "GET" && path === `${REALM}/certs`)
      return send(res, 200, {
        keys: [{ ...publicKey.export({ format: "jwk" }), use: "sig", alg: "RS256", kid: KID }],
      })
    if (req.method === "GET" && path === "/_health") return send(res, 200, { status: "UP" })
    if (req.method === "GET" && path === "/_log") return send(res, 200, { issued: LOG })
    if (req.method === "POST" && path === `${REALM}/token`) {
      const form = new URLSearchParams(raw)
      const client = CLIENTS[form.get("client_id") ?? ""]
      if (
        form.get("grant_type") !== "client_credentials" ||
        !client ||
        !secretMatches(client.secret, form.get("client_secret"))
      )
        return send(res, 401, { error: "invalid_client" })
      const requested = (form.get("scope") ?? "").split(" ").filter(Boolean)
      const granted = requested.filter((s) => client.scopes.includes(s))
      const token = issue(
        client.subject ?? form.get("client_id"),
        client.audience,
        granted.length ? granted : client.scopes,
        "workload",
        form.get("client_id"),
      )
      return send(res, 200, { access_token: token, token_type: "Bearer", expires_in: LIFETIME })
    }
    if (req.method === "POST" && path === "/_mint") {
      const r = JSON.parse(raw || "{}")
      // A human session carries IAM's realm roles and its authentication
      // assurance (acr / auth_time), which CP's administration policy reads.
      const extra =
        r.actor_type === "human"
          ? {
              realm_access: { roles: r.roles ?? [] },
              acr: r.acr ?? "1",
              auth_time: Math.floor(Date.now() / 1000) - 5,
            }
          : {}
      return send(res, 200, {
        access_token: issue(
          r.subject,
          r.audience,
          r.scopes,
          r.actor_type,
          r.client ?? "ta08-harness",
          extra,
        ),
      })
    }
    return send(res, 404, { error: "not_found" })
  })
})
// Node closes idle keep-alive sockets after 5 s; a client that reuses one the
// server just closed sees "fetch failed". Outlast the callers' idle sockets.
server.keepAliveTimeout = 65_000
server.headersTimeout = 66_000
server.listen(Number(process.env.PORT ?? 8000))
