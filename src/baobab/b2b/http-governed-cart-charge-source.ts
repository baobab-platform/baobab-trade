import { createPublicKey, type KeyObject } from "node:crypto"
import type { WorkloadTokenProvider } from "../control-plane/workload-token"
import type { PgPool } from "../orders/postgres-governed-binding-persistence"
import type {
  ChargeEvidence, ChargeIssuerMandate, GovernedChargeIssuer,
  SignedChargeEvidence,
} from "./governed-cart-charge-issuer"

/** Concrete confidential provider HTTPS adapter. This does not compute a
 * tax, duty or freight fact, forge a zero or replace CP legal-actor authority.
 * The issuer must publish an Ed25519-signed complete seven-charge package,
 * and the independently implemented CP verifier must approve this issuer.
 */
export type FinalChargeHttpSourceOptions = {
  endpoint: string
  workload: WorkloadTokenProvider
  publicKeyPem: string
  cpVerifier: (evidence: ChargeEvidence) => Promise<ChargeIssuerMandate>
  db: PgPool
  fetcher?: typeof fetch
}

const ID = /^cart_[A-Za-z0-9_-]{6,128}$/
function refuse(): never {
  throw new Error("FINAL_CHARGE_SOURCE_UNAVAILABLE")
}
async function jsonBounded(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok ||
      !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
      !response.body) return refuse()
  const reader = response.body.getReader()
  let count = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      signal.throwIfAborted()
      const part = await reader.read()
      if (part.done) break
      count += part.value.byteLength
      if (count > 32768) return refuse()
      chunks.push(part.value)
    }
    signal.throwIfAborted()
    return JSON.parse(new TextDecoder("utf-8", { fatal: true })
      .decode(Buffer.concat(chunks, count)))
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export class HttpGovernedCartChargeSource implements GovernedChargeIssuer {
  readonly publicKey: KeyObject
  readonly db: PgPool
  private readonly endpoint: string
  private readonly workload: WorkloadTokenProvider
  private readonly fetcher: typeof fetch
  private readonly cpVerifier: (evidence: ChargeEvidence) => Promise<ChargeIssuerMandate>

  constructor(options: FinalChargeHttpSourceOptions) {
    const url = new URL(options.endpoint)
    if (url.protocol !== "https:" || url.username || url.password ||
        url.search || url.hash ||
        url.pathname !== "/v1/trade/cart-final-charges" ||
        process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") return refuse()
    const key = createPublicKey(options.publicKeyPem)
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519" ||
        typeof options.workload?.getAccessToken !== "function" ||
        typeof options.cpVerifier !== "function" || !options.db) return refuse()
    this.endpoint = url.href
    this.workload = options.workload
    this.publicKey = key
    this.cpVerifier = options.cpVerifier
    this.db = options.db
    this.fetcher = options.fetcher ?? fetch
  }
  verifyCpIssuer(evidence: ChargeEvidence): Promise<ChargeIssuerMandate> {
    return this.cpVerifier(evidence)
  }
  async obtainFromIssuer(cartId: string): Promise<SignedChargeEvidence> {
    if (!ID.test(cartId)) return refuse()
    const signal = AbortSignal.timeout(5000)
    try {
      const credential = await this.workload.getAccessToken()
      if (!credential || credential.length > 16384) return refuse()
      const response = await this.fetcher(this.endpoint, {
        method: "POST", cache: "no-store", redirect: "error", signal,
        headers: {
          Authorization: `Bearer ${credential}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({cart_id: cartId}),
      })
      const result = await jsonBounded(response, signal)
      if (!result || typeof result !== "object" || Array.isArray(result) ||
          Object.keys(result).sort().join() !== "evidence,signature") return refuse()
      const signed = result as SignedChargeEvidence
      if (!signed.evidence || signed.evidence.cartId !== cartId ||
          typeof signed.signature !== "string") return refuse()
      // The mandatory Ed25519 signature, policy, CP mandate and seven facts
      // are independently rechecked by verifyGovernedChargeEvidence.
      return signed
    } catch {
      return refuse()
    }
  }
}
