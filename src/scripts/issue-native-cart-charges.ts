import { randomUUID } from "node:crypto"
import { nativeBuyerCommitRuntime } from "../baobab/b2b/native-buyer-commit-runtime"
import { issueGovernedCartCharges } from "../baobab/b2b/governed-cart-charge-issuer"

/** The deployment operator supplies only the native cart selector. The
 * authenticated provider and CP own every price and issuer decision. */
export default async function issueNativeCartCharges() {
  try {
    const cartId = process.env.BAOBAB_NATIVE_PRICE_CART_ID ?? ""
    const runtime = nativeBuyerCommitRuntime()
    await issueGovernedCartCharges(runtime.chargeSource(randomUUID()), cartId)
    console.info("Governed native cart charges recorded")
  } catch {
    throw new Error("GOVERNED_NATIVE_CART_CHARGE_ISSUANCE_FAILED")
  }
}
