import { createHash } from "node:crypto"
import type { WorkloadTokenProvider } from "./workload-token"
import { withTradeCpHttpSpan } from "../observability/tracing"
import {
  signedChargeBytes,
  type ChargeEvidence,
  type ChargeIssuerMandate,
} from "../b2b/governed-cart-charge-issuer"
import type {
  NativePriceIssuerCheck,
  NativePriceIssuerDecision,
} from "../b2b/medusa-final-cart-pricing"

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const HEX = /^[a-f0-9]{64}$/
const PATH = "/internal/trade/v1/price-issuer/resolve"
const refuse = (): never => {
  throw new Error("CP_PRICE_ISSUER_AUTHORITY_NOT_PROVEN")
}
type Check = Omit<NativePriceIssuerCheck, "decisionId"> & {
  decisionId?: string
  evidenceExpiresAt?: string
}

/** CP owns both the issuance decision and live redemption. Signed price
 * facts still belong to the issuer. A matching response never stands in for
 * validating the signature, exact cart version or operation authority. */
export class HttpTradePriceIssuerAuthority {
  private readonly endpoint: string
  constructor(
    origin: URL,
    private readonly tokens: WorkloadTokenProvider,
    private readonly signerFingerprint: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (!HEX.test(signerFingerprint)) refuse()
    this.endpoint = new URL(PATH, origin).href
  }

  async verifyCurrent(
    check: NativePriceIssuerCheck,
    correlation: string,
  ): Promise<NativePriceIssuerDecision> {
    return withTradeCpHttpSpan((trace) => this.resolve(check, correlation, trace))
  }

  async verifyPackage(evidence: ChargeEvidence, correlation: string): Promise<ChargeIssuerMandate> {
    const decision = await withTradeCpHttpSpan((trace) =>
      this.resolve(
        {
          tenantId: evidence.tenantId,
          cartId: evidence.cartId,
          marketId: evidence.marketId,
          sellerLegalEntityId: evidence.sellerLegalEntityId,
          currency: evidence.currency,
          issuerId: evidence.issuerId,
          policyReference: evidence.policyReference,
          sourceDigest: createHash("sha256").update(signedChargeBytes(evidence)).digest("hex"),
          evidenceExpiresAt: evidence.expiresAt,
        },
        correlation,
        trace,
      ),
    )
    return { ...decision, cpDecisionId: decision.decisionId }
  }

  private async resolve(
    check: Check,
    correlation: string,
    trace?: string,
  ): Promise<NativePriceIssuerDecision> {
    try {
      if (
        !HEX.test(check.sourceDigest) ||
        !UUID.test(correlation) ||
        (check.decisionId !== undefined && !UUID.test(check.decisionId))
      )
        return refuse()
      const signal = AbortSignal.timeout(3000)
      const token = await this.tokens.getAccessToken()
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-correlation-id": correlation,
          ...(trace ? { traceparent: trace } : {}),
        },
        body: JSON.stringify({ ...check, signerKeyFingerprint: this.signerFingerprint }),
      })
      if (
        !response.ok ||
        !response.body ||
        !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")
      ) {
        void response.body?.cancel().catch(() => undefined)
        return refuse()
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        for (;;) {
          signal.throwIfAborted()
          const { done, value } = await reader.read()
          if (done) break
          length += value.length
          if (length > 8192) return refuse()
          chunks.push(value)
        }
      } finally {
        void reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
      signal.throwIfAborted()
      const value = JSON.parse(
        Buffer.concat(chunks, length).toString("utf8"),
      ) as NativePriceIssuerDecision & {
        cartId?: string
        currency?: string
        signerKeyFingerprint?: string
      }
      const now = this.now(),
        expires = Date.parse(value.expiresAt)
      if (
        value.outcome !== "AUTHORIZED" ||
        !UUID.test(value.decisionId) ||
        (check.decisionId !== undefined && value.decisionId !== check.decisionId) ||
        value.issuerId !== check.issuerId ||
        value.tenantId !== check.tenantId ||
        value.marketId !== check.marketId ||
        value.sellerLegalEntityId !== check.sellerLegalEntityId ||
        value.policyReference !== check.policyReference ||
        value.sourceDigest !== check.sourceDigest ||
        value.cartId !== check.cartId ||
        value.currency !== check.currency ||
        value.signerKeyFingerprint !== this.signerFingerprint ||
        !Number.isFinite(expires) ||
        expires <= now ||
        expires > now + (check.decisionId ? 30000 : 300000) ||
        (check.evidenceExpiresAt !== undefined && !(expires <= Date.parse(check.evidenceExpiresAt)))
      )
        return refuse()
      return value
    } catch {
      return refuse()
    }
  }
}
