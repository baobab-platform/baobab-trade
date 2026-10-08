import { createHmac, timingSafeEqual } from "node:crypto"

export type PaymentWebhookInput = {
  providerKey: string
  eventId: string
  timestampSeconds: number
  rawBody: string
  signature: string
}

export const signPaymentWebhook = (
  input: Omit<PaymentWebhookInput, "signature">,
  secret: string,
): string =>
  createHmac("sha256", secret).update(`${input.timestampSeconds}.${input.rawBody}`).digest("hex")

export const assertValidPaymentWebhook = (
  input: PaymentWebhookInput,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): void => {
  if (!secret) throw new Error("Payment webhook secret is not configured")
  if (!input.eventId || !input.providerKey) throw new Error("Payment webhook identity is missing")
  if (Math.abs(nowSeconds - input.timestampSeconds) > toleranceSeconds)
    throw new Error("Payment webhook timestamp is outside the replay window")
  const expected = signPaymentWebhook(input, secret)
  const supplied = Buffer.from(input.signature, "hex")
  const calculated = Buffer.from(expected, "hex")
  if (supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated))
    throw new Error("Payment webhook signature is invalid")
}
