import { readFileSync, statSync } from "node:fs"
import { createServer } from "node:https"
import { Pool } from "pg"
import {
  dev07PrivateSigner,
  signDev07SyntheticPrice,
  type Dev07SyntheticProfile,
  type Dev07Cart,
} from "../baobab/b2b/dev07-synthetic-price-issuer"

/** This is a real private HTTPS server, not an HTTP mock for CP/IAM.
 * It introspects each caller with IAM and reads the actual open Medusa cart.
 * Trade independently verifies CP #465 approval, price signature and final
 * Medusa totals. Synthetic numbers are never a tax or legal determination.
 */
const fail = (): never => {
  throw new Error("DEV07_PRICE_ISSUER_UNAVAILABLE")
}
const required = (name: string) => process.env[name]?.trim() || fail()
const httpsOnly = (value: string) => {
  const u = new URL(value)
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return fail()
  return u
}
const privateFile = (name: string) => {
  const path = required(name)
  const stat = statSync(path)
  if (!stat.isFile() || stat.size > 131072 || (stat.mode & 0o077) !== 0) return fail()
  return readFileSync(path)
}
export type Dev07Introspection = {
  url: URL
  clientId: string
  clientSecret: string
  issuer: string
  audience: string
  allowedCaller: string
  fetcher?: typeof fetch
  now?: () => number
}

export async function verifyDev07Caller(token: string, c: Dev07Introspection): Promise<void> {
  if (!/^[A-Za-z0-9._~-]{20,16384}$/.test(token)) return fail()
  const auth = Buffer.from(c.clientId + ":" + c.clientSecret).toString("base64")
  const response = await (c.fetcher ?? fetch)(c.url, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + auth,
    },
    body: new URLSearchParams({ token }),
  })
  if (
    !response.ok ||
    !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
    !response.body ||
    Number(response.headers.get("content-length") ?? "0") > 8192
  )
    return fail()
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const piece of response.body) {
    length += piece.byteLength
    if (length > 8192) return fail()
    chunks.push(piece)
  }
  const fact = JSON.parse(Buffer.concat(chunks, length).toString("utf8")) as Record<string, unknown>
  const audiences = typeof fact.aud === "string" ? [fact.aud] : fact.aud
  const now = (c.now ?? Date.now)()
  if (
    fact.active !== true ||
    fact.client_id !== c.allowedCaller ||
    fact.iss !== c.issuer ||
    fact.actor_type !== "workload" ||
    !Array.isArray(audiences) ||
    audiences.length !== 1 ||
    audiences[0] !== c.audience ||
    typeof fact.scope !== "string" ||
    !fact.scope.split(" ").includes("trade:cart-final-charges") ||
    typeof fact.exp !== "number" ||
    !Number.isSafeInteger(fact.exp) ||
    fact.exp * 1000 <= now
  )
    return fail()
}

export async function readDev07Cart(pool: Pick<Pool, "query">, cartId: string): Promise<Dev07Cart> {
  if (!/^cart_[A-Za-z0-9_-]{6,128}$/.test(cartId)) return fail()
  const response = await pool.query(
    "SELECT b.tenant_id,b.market_key,b.market_code,b.responsible_legal_entity_id," +
      "b.currency_code AS binding_currency,c.currency_code AS cart_currency," +
      "c.updated_at,c.completed_at," +
      "to_char(c.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS updated_at_exact " +
      "FROM native_seller_cart_binding b JOIN cart c ON c.id=b.cart_id " +
      "WHERE b.cart_id=$1 AND b.status='ACTIVE' AND b.deleted_at IS NULL " +
      "AND b.expires_at>clock_timestamp() AND c.deleted_at IS NULL",
    [cartId],
  )
  if (response.rows.length !== 1) return fail()
  const r = response.rows[0]
  if (
    r.completed_at !== null ||
    !(r.updated_at instanceof Date) ||
    typeof r.updated_at_exact !== "string" ||
    typeof r.binding_currency !== "string" ||
    !/^[A-Z]{3}$/.test(r.binding_currency) ||
    typeof r.cart_currency !== "string" ||
    r.binding_currency !== r.cart_currency.toUpperCase()
  )
    return fail()
  return {
    cartId,
    tenantId: r.tenant_id,
    marketKey: r.market_key,
    countryCode: r.market_code,
    sellerLegalEntityId: r.responsible_legal_entity_id,
    currency: r.binding_currency,
    updatedAtExact: r.updated_at_exact,
    resourceVersion: r.updated_at.getTime(),
  }
}

export async function serveDev07SyntheticPriceIssuer(): Promise<void> {
  if (
    process.env.BAOBAB_DEV07_SYNTHETIC_PRICE_ISSUER_ENABLED !== "true" ||
    !["development", "integration"].includes(required("BAOBAB_ENVIRONMENT")) ||
    ["NODE_ENV", "BAOBAB_DEPLOYMENT_ENV"].some(
      (key) => ![undefined, "development", "integration", "test"].includes(process.env[key]),
    ) ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  )
    return fail()
  const profile = JSON.parse(
    privateFile("BAOBAB_DEV07_PRICE_PROFILE_FILE").toString("utf8"),
  ) as Dev07SyntheticProfile
  const signer = dev07PrivateSigner(
    privateFile("BAOBAB_DEV07_PRICE_SIGNING_KEY_FILE").toString("utf8"),
  )
  const tlsKey = privateFile("BAOBAB_DEV07_PRICE_TLS_KEY_FILE")
  const tlsCert = readFileSync(required("BAOBAB_DEV07_PRICE_TLS_CERT_FILE"))
  const config: Dev07Introspection = {
    url: httpsOnly(required("BAOBAB_DEV07_IAM_INTROSPECTION_URL")),
    clientId: required("BAOBAB_DEV07_IAM_INTROSPECTION_CLIENT_ID"),
    clientSecret: required("BAOBAB_DEV07_IAM_INTROSPECTION_CLIENT_SECRET"),
    issuer: required("BAOBAB_DEV07_IAM_ISSUER"),
    audience: required("BAOBAB_DEV07_PRICE_AUDIENCE"),
    allowedCaller: required("BAOBAB_NATIVE_PRICE_PROVIDER_CLIENT_ID"),
  }
  const database = new URL(required("DATABASE_URL"))
  if (!["postgres:", "postgresql:"].includes(database.protocol)) return fail()
  const pool = new Pool({ connectionString: database.href, max: 2, statement_timeout: 4000 })
  const server = createServer({ key: tlsKey, cert: tlsCert }, async (req, res) => {
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Content-Type", "application/json")
    try {
      if (
        req.method !== "POST" ||
        req.url !== "/v1/trade/cart-final-charges" ||
        !/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")
      )
        return fail()
      const bearer = /^Bearer ([A-Za-z0-9._~-]{20,16384})$/.exec(
        req.headers.authorization ?? "",
      )?.[1]
      if (!bearer) return fail()
      await verifyDev07Caller(bearer, config)
      let raw = ""
      for await (const chunk of req) {
        raw += chunk.toString("utf8")
        if (Buffer.byteLength(raw) > 2048) return fail()
      }
      const request = JSON.parse(raw) as Record<string, unknown>
      if (
        !request ||
        Object.keys(request).join() !== "cart_id" ||
        typeof request.cart_id !== "string"
      )
        return fail()
      const cart = await readDev07Cart(pool, request.cart_id)
      const signed = signDev07SyntheticPrice(profile, cart, signer)
      res.writeHead(200)
      res.end(JSON.stringify(signed))
    } catch {
      res.writeHead(403)
      res.end('{"error":"PRICE_SOURCE_UNAVAILABLE"}')
    }
  })
  const port = Number(required("BAOBAB_DEV07_PRICE_PORT"))
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) return fail()
  server.listen(port, required("BAOBAB_DEV07_PRICE_BIND_ADDRESS"))
  const close = () => {
    server.close()
    void pool.end()
  }
  process.once("SIGTERM", close)
  process.once("SIGINT", close)
}
if (process.argv[1]?.endsWith("serve-dev07-synthetic-price-issuer.ts")) {
  void serveDev07SyntheticPriceIssuer().catch(() => {
    process.exitCode = 1
  })
}
