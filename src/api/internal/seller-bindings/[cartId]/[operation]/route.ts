import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type NativeSellerCheckoutModuleService from "../../../../../modules/legal-seller-checkout/service"
import { NATIVE_SELLER_DEPENDENCY_KEY } from "../../../../../baobab/orders/native-cart-legal-seller"
import type { BindingOperation } from "../../../../../baobab/orders/binding-authority-client"

/** Internal human command route: CP verifies the actual Bearer token and
 * current grant. Browser/Medusa claims, headers and receipts confer nothing. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const operation = req.params.operation
  const authorization = req.headers.authorization
  if (
    !["propose", "approve", "activate", "revoke"].includes(operation) ||
    typeof authorization !== "string" ||
    !/^Bearer [^\s]+$/.test(authorization) ||
    authorization.length > 16391
  ) {
    res.status(403).json({ code: "BINDING_COMMAND_DENIED" })
    return
  }
  try {
    const module = req.scope.resolve<NativeSellerCheckoutModuleService>(
      NATIVE_SELLER_DEPENDENCY_KEY,
    )
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    await module.executeBindingCommand(
      operation as BindingOperation,
      req.params.cartId,
      req.body,
      authorization.slice(7),
      async (id) => {
        const { data } = await query.graph({
          entity: "cart",
          fields: ["id", "sales_channel_id", "region_id", "currency_code", "completed_at"],
          filters: { id },
        })
        if (
          data.length !== 1 ||
          !data[0].sales_channel_id ||
          !data[0].region_id ||
          !data[0].currency_code
        )
          throw new Error("Native cart coordinates unavailable")
        return {
          salesChannelId: data[0].sales_channel_id,
          regionId: data[0].region_id,
          currencyCode: data[0].currency_code.toUpperCase(),
          completed: Boolean(data[0].completed_at),
        }
      },
    )
    res.status(204).send()
  } catch {
    // Uniform denial: do not leak cart existence, tokens, CP/provider or DB errors.
    res.status(403).json({ code: "BINDING_COMMAND_DENIED" })
  }
}
