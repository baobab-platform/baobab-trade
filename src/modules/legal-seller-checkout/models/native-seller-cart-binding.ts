import { model } from "@medusajs/framework/utils"

/**
 * LA-05C3: populated ONLY by governed server-side provisioning, never from
 * Store API cart metadata or a browser-supplied LegalEntity identifier.
 */
const NativeSellerCartBinding = model.define(
  {
    name: "native_seller_cart_binding",
    tableName: "native_seller_cart_binding",
  },
  {
    id: model.id({ prefix: "lsbind" }).primaryKey(),
    cart_id: model.text().unique(),
    tenant_id: model.text().index(),
    organisation_id: model.text().index(),
    context_id: model.text(),
    responsible_legal_entity_id: model.text(),
    sales_channel_id: model.text(),
    region_id: model.text(),
    market_code: model.text(),
    market_key: model.text(),
    legal_activity: model.text(),
    legal_capability: model.text(),
    currency_code: model.text(),
    approval_reference: model.text().nullable(),
    approval_scope: model.text(),
    proposed_by: model.text(),
    proposed_at: model.dateTime(),
    approved_by: model.text().nullable(),
    approved_at: model.dateTime().nullable(),
    expires_at: model.dateTime(),
    status: model
      .enum(["PROPOSED", "ACTIVE", "REJECTED", "REVOKED", "EXPIRED"])
      .default("PROPOSED"),
    correlation_id: model.text(),
  },
)
export default NativeSellerCartBinding
