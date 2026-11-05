import { createPrivateKey, randomUUID, sign, type KeyObject } from "node:crypto"
import {
  REQUIRED_CHARGES,
  signedChargeBytes,
  type ChargeEvidence,
  type SignedChargeEvidence,
} from "./governed-cart-charge-issuer"

/** DEV-07 only: invented commercial amounts with genuine cryptographic
 * issuer signature. This NEVER supplies a buyer grant, seller mandate,
 * government rate, regulatory clearance or CP issuer approval.
 */
export type Dev07SyntheticProfile = {
  syntheticOnly: true
  tenantId: string
  marketId: string
  marketKey: string
  countryCode: string
  sellerLegalEntityId: string
  currency: string
  issuerId: string
  policyReference: string
  charges: ChargeEvidence["charges"]
}
export type Dev07Cart = {
  cartId: string
  tenantId: string
  marketKey: string
  countryCode: string
  sellerLegalEntityId: string
  currency: string
  updatedAtExact: string
  resourceVersion: number
}
const fail = (): never => {
  throw new Error("DEV07_SYNTHETIC_PRICE_NOT_PROVEN")
}
const ID = /^[A-Za-z0-9._:-]{3,200}$/
const REASONS = {
  ZERO_RATED: "ZERO_RATE_AUTHORISED",
  EXEMPT: "EXEMPTION_DOCUMENTED",
  NOT_APPLICABLE: "NOT_APPLICABLE_PER_INCOTERM",
} as const

export function dev07PrivateSigner(pem: string): KeyObject {
  const key = createPrivateKey(pem)
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") return fail()
  return key
}

export function signDev07SyntheticPrice(
  profile: Dev07SyntheticProfile,
  cart: Dev07Cart,
  privateKey: KeyObject,
  now = Date.now(),
): SignedChargeEvidence {
  if (
    !profile ||
    !cart ||
    profile.syntheticOnly !== true ||
    privateKey?.type !== "private" ||
    privateKey.asymmetricKeyType !== "ed25519" ||
    !Number.isSafeInteger(now) ||
    !/^cart_[A-Za-z0-9_-]{6,128}$/.test(cart.cartId) ||
    ![profile.tenantId, profile.marketId, profile.sellerLegalEntityId, profile.issuerId].every(
      (v) => typeof v === "string" && ID.test(v),
    ) ||
    typeof profile.marketKey !== "string" ||
    !/^[A-Za-z0-9._:-]{2,200}$/.test(profile.marketKey) ||
    !/^[A-Z]{2}$/.test(profile.countryCode) ||
    !/^[A-Z]{3}$/.test(profile.currency) ||
    !/^[!-~]{8,200}$/.test(profile.policyReference) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(cart.updatedAtExact) ||
    !Number.isSafeInteger(cart.resourceVersion) ||
    cart.resourceVersion < 1 ||
    Date.parse(cart.updatedAtExact) !== cart.resourceVersion ||
    cart.tenantId !== profile.tenantId ||
    cart.marketKey !== profile.marketKey ||
    cart.countryCode !== profile.countryCode ||
    cart.sellerLegalEntityId !== profile.sellerLegalEntityId ||
    cart.currency !== profile.currency ||
    !Array.isArray(profile.charges) ||
    profile.charges.length !== REQUIRED_CHARGES.length
  )
    return fail()

  const kinds = new Set<string>()
  for (const line of profile.charges) {
    if (
      !line ||
      !REQUIRED_CHARGES.includes(line.kind) ||
      kinds.has(line.kind) ||
      !/^(0|[1-9][0-9]{0,15})$/.test(line.amountMinor) ||
      BigInt(line.amountMinor) > BigInt(Number.MAX_SAFE_INTEGER) ||
      typeof line.sourceReference !== "string" ||
      !/^synthetic:dev07:[!-~]{1,184}$/.test(line.sourceReference) ||
      !["CHARGED", "ZERO_RATED", "EXEMPT", "NOT_APPLICABLE"].includes(line.resolution)
    )
      return fail()
    if (line.resolution === "CHARGED") {
      if (line.amountMinor === "0" || line.zeroReason !== null) return fail()
    } else if (line.amountMinor !== "0" || line.zeroReason !== REASONS[line.resolution]) {
      return fail()
    }
    kinds.add(line.kind)
  }
  if (!REQUIRED_CHARGES.every((kind) => kinds.has(kind))) return fail()
  const evidence: ChargeEvidence = {
    issuerId: profile.issuerId,
    attestationId: randomUUID(),
    tenantId: cart.tenantId,
    cartId: cart.cartId,
    marketId: profile.marketId,
    sellerLegalEntityId: cart.sellerLegalEntityId,
    currency: cart.currency,
    resourceVersion: cart.resourceVersion,
    cartUpdatedAtExact: cart.updatedAtExact,
    evaluatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30000).toISOString(),
    policyReference: profile.policyReference,
    charges: REQUIRED_CHARGES.map((kind) => profile.charges.find((line) => line.kind === kind)!),
  }
  return {
    evidence,
    signature: sign(null, signedChargeBytes(evidence), privateKey).toString("base64url"),
  }
}
